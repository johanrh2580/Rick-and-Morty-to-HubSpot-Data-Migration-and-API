// test_axios_connectivity.js
const axios = require('axios');

async function testConnectivity() {
    console.log('INFO: Testing Axios connectivity...');
    try {
        const response = await axios.get('https://jsonplaceholder.typicode.com/todos/1');
        console.log('SUCCESS: Axios call to jsonplaceholder.typicode.com successful!');
        console.log('Data received:', response.data);
    } catch (error) {
        console.error('ERROR: Failed to connect using Axios.');
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
            console.error('Headers:', error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            console.error('No response received from server. Request details:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error message:', error.message);
        }
        console.error('Config:', error.config); // Show the request configuration
    }
}

testConnectivity();