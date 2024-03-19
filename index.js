require ('dotenv').config();
const { getAuth } = require("firebase-admin/auth");
const axios = require('axios');
const rateLimit = require('axios-rate-limit');
const admin = require('firebase-admin');
const { SKIP_DOMAINS }  = require ('./skip_domains.js'); // where an array of domains to skip e.g. internal, test emails.

const serviceAccount = require(process.env.FIREBASE_KEY)
let countA = 0;
let countB = 0;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const getUserList = () => {
  return admin.auth().listUsers()  //only feasible for user number less than 1000
    .then (userRecord => {
      return userRecord.users.map(user => {
        return {
          uid: user.uid,
          email: user.email
        }
      })
    })
    .catch ((error) => {
      console.log(error)
    })
}

const client = rateLimit(axios.create(), {
  maxRequests: 8, // The maximum number of requests per second
  perMilliseconds: 1000 // The time period in milliseconds
});

const fetchRevenueCat = (user) => {
  if (SKIP_DOMAINS.some(domain => user.email.includes(domain))){
    console.log('Skipped internal email: ', user.email);
  } else {
    client ({
      method: 'get',
      url: `https://api.revenuecat.com/v1/subscribers/${user.uid}`,
      headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REVENUECAT_API_KEY}`,
      }
    })
    .then (response => {        
      // Preformat some tricky fields.
      let displayName;
      if (response.data.subscriber.subscriber_attributes.$displayName) {
          displayName = response.data.subscriber.subscriber_attributes.$displayName.value;
      }

      let formattedProductName = Object.keys(response.data.subscriber.subscriptions)[0];
      let storeName;
      let expiry;
      let unsubcribe;
      let periodType = "Idle";

      if (response.data.subscriber.subscriptions[formattedProductName]) {

          storeName = response.data.subscriber.subscriptions[formattedProductName].store;
          expiry = response.data.subscriber.subscriptions[formattedProductName].expires_date;
          unsubscribe = response.data.subscriber.subscriptions[formattedProductName].unsubscribe_detected_at;
          periodType = response.data.subscriber.subscriptions[formattedProductName].period_type;
      }
      
      let store;
        switch (storeName) {
            case "app_store":
                store = "Apple";
                break;
            case "play_store":
                store = "Google";
                break;
            case "stripe":
                store = "Stripe";
                break;
            default:
                store = "Unknown"
        };
      
      const userData = {
          "ext_id": user.uid,
          "email": user.email,
          'attributes': {
            'USERID': user.uid,
            "DISPLAY_NAME": displayName,
            "FIRST_SEEN": response.data.subscriber.first_seen,
            "LAST_SEEN": response.data.subscriber.last_seen,
            "FIRST_PURCHASE": response.data.subscriber.original_purchase_date,
            "PRODUCT": formattedProductName,
            "EXPIRY": expiry,
            "STORE": store,
            "UNSUBSCRIBED": unsubcribe,
            "STATUS": periodType,
          }
      };
      countA++
      console.log(countA, "fetching data: ", userData.email, userData.ext_id);
      return userData;
    })
    .then ((userData) => {createBrevoSubscriber(userData)})
    .catch (error => {
      console.log('unable to fetch data from RevenueCat: ', user.uid)
    })
  }
};
const createBrevoSubscriber = (userData) => {
  client ({
    method: 'post',
    url: 'https://api.brevo.com/v3/contacts',
    headers: {
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
    },
    data: userData
  }).then ((response)=>{
    countB++
    console.log(countB, 'Sucessfully imported to Brevo')
  }).catch ((error) => {
    console.log('Brevo error')
  })
};

function main () {
  getUserList()
  .then ((userList) => {
    userList.forEach(fetchRevenueCat)
  })
  .then ((userData) => {
    createBrevoSubscriber(userData)
  })
};


main();