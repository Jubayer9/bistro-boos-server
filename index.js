const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const cors = require('cors');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const port = process.env.PORT || 5000

// middleware
app.use(cors());
app.use(express.json())
app.use(morgan('dev'))
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  console.log(req.headers);
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next()
  })

}



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.43vj3zh.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();


    const usersCollection = client.db("bistroDB").collection('users');
    const menuCollection = client.db("bistroDB").collection('menu');
    const reviewCollection = client.db("bistroDB").collection('reviews');
    const cartCollection = client.db("bistroDB").collection('carts');
    const paymentCollection = client.db("bistroDB").collection('payments');


    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '100h' })
      res.send({ token })
    })

    // Warning: use verifyJWT before using verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ error: true, message: 'forbidden message' })
      }
      next()
    }


    // users related apis

    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const insertResult = await usersCollection.find().toArray();
      res.send(insertResult)
    })


    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'user already exists' })
      }
      const insertResult = await usersCollection.insertOne(user);

      res.send(insertResult);

    });

    // security layer: verifyJWT
    // email same
    // check admin
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {

      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false })
      }


      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const insertResult = { admin: user?.role === 'admin' }
      res.send(insertResult)
    })
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: 'admin'
        },
      };
      const insertResult = await usersCollection.updateOne(filter, updateDoc)
      res.send(insertResult);
    })


    // menu related apis
    app.get('/menu', async (req, res) => {
      const insertResult = await menuCollection.find().toArray();
      res.send(insertResult)
    })

    // new Item add menu
    app.post('/menu', verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const insertResult = await menuCollection.insertOne(newItem)
      res.send(insertResult);

    })
    app.delete('/menu/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const insertResult = await menuCollection.deleteOne(query)
      res.send(insertResult)
    })

    // review related api
    app.get('/reviews', async (req, res) => {
      const insertResult = await reviewCollection.find().toArray();
      res.send(insertResult)
    })

    //cart collection apis
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;
      console.log(email);
      if (!email) {
        res.send([]);
      }


      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: ' Forbidden access' })
      }


      const query = { email: email };
      const insertResult = await cartCollection.find(query).toArray();
      res.send(insertResult);

    });

    // cart collection 
    app.post('/carts', async (req, res) => {
      const item = req.body;
      const insertResult = await cartCollection.insertOne(item);
      console.log(insertResult);

      res.send(insertResult)

    })

    // delete cart
    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const insertResult = await cartCollection.deleteOne(query)

      res.send(insertResult)
    })

    // create payment intent
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt((price * 100).toFixed(2))
        ;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ['card']


      });

      res.send({
        clientSecret: paymentIntent.client_secret
      })

    })

    // payment related api
    app.post('/payments', verifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);
      const query = { _id: { $in: payment.cartItems.map(id => new ObjectId(id)) } }
      const deleteResult = await cartCollection.deleteMany(query)
      res.send({ insertResult, deleteResult });
    })

    app.get('/admin-stats', async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      // best way to get sum of a field is to use group and sum operator
      /**
       * PaymentCollection.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: '$amount'}
          }
        }
      ]).toArray
       * 
       */
      const payments = await paymentCollection.find().toArray()
      const revenue = payments.reduce((sum, payment) => sum + payment.price, 0)
      res.send({
        users,
        products,
        orders,
        revenue
      })
    })
    /**
     * -----------------------------------
     * BANGLA SYSTEM(second bets solution)
     * -----------------------------------
     * 1. load all payments
     * 2. for each item in the menuItems array get the menuItems array
     * 3. for each item in the menuItems array get the menuItem from the menu collection
     * 4. put them in an array: allOrderedItems
     * 5. separate allOrderedItems  by category using filter 
     * 6. now get the quantity by using length: pizzas.length
     * 7. for each category use reduce to get the total amount spent on this  category
     * 
     */
    app.get('/order-stars',verifyJWT,verifyAdmin, async (req, res) => {

      const pipeline = [
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItems',
            foreignField: '_id',
            as: 'menuItem'
          }
        },
        { $unwind: '$menuItem' },
        {
          $group: {
            _id: '$menuItem.category',
            count: { $sum: 1 },
            totalPrice: { $sum: '$menuItem.price' }
          }
        },
        {
          $project:{
            category:'$_id',
            count:1,
            totalPrice:{$round:['$totalPrice',2]}
          }
        }

      ];
      const result = await paymentCollection.aggregate(pipeline).toArray()
      res.send(result)
    })


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('boss is sitting')
})

app.listen(port, () => {
  console.log(`Bistro boss is sitting on port ${port}`);
})


/**
 * ----------------------------
 *     NAMING CONVENTION
 * ----------------------------
 * USERS: userCollection
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.patch('/users/:id')
 * app.put('/users/:id')
 * app.delete('/users/:id')
 */
