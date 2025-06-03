// test_hubspot_api.js
const hubspot = require('@hubspot/api-client');
require('dotenv').config(); // Asegúrate de cargar las variables de entorno

// Usamos el token del .env, como en tu app principal
const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_SOURCE_TOKEN; 

if (!HUBSPOT_ACCESS_TOKEN) {
    console.error('ERROR: HUBSPOT_ACCESS_TOKEN_SOURCE no está definido en tu archivo .env. Por favor, revísalo.');
    process.exit(1);
}

const hubspotClient = new hubspot.Client({ accessToken: HUBSPOT_ACCESS_TOKEN });

async function testHubSpotContactCreation() {
    console.log('INFO: Testing HubSpot Contact Creation...');

    // Creamos un email único para cada intento
    const uniqueEmail = `testcontact-${Date.now()}@example.com`; 

    const contactData = {
        properties: {
            firstname: 'Test',
            lastname: 'Contact',
            email: uniqueEmail,
            lifecyclestage: 'lead',
        },
    };

    try {
        console.log(`INFO: Attempting to create contact with email: ${uniqueEmail}`);
        const createdContact = await hubspotClient.crm.contacts.basicApi.create(contactData);
        console.log('SUCCESS: HubSpot Contact created successfully!');
        console.log('Created Contact ID:', createdContact.id);
        console.log('Created Contact Properties:', JSON.stringify(createdContact.properties, null, 2));

        // Opcional: Intenta recuperar el contacto
        console.log(`INFO: Attempting to retrieve contact with ID: ${createdContact.id}`);
        const retrievedContact = await hubspotClient.crm.contacts.basicApi.getById(createdContact.id, ['email', 'firstname']);
        console.log('SUCCESS: Retrieved contact by ID:', retrievedContact.id);

        // Opcional: Intenta actualizar el contacto
        console.log(`INFO: Attempting to update contact with ID: ${createdContact.id}`);
        const updateData = { properties: { lastname: 'UpdatedLastName' } };
        const updatedContact = await hubspotClient.crm.contacts.basicApi.update(createdContact.id, updateData);
        console.log('SUCCESS: Contact updated:', updatedContact.id, updatedContact.properties.lastname);

    } catch (error) {
        console.error('ERROR: Failed to interact with HubSpot Contact API.');
        if (error.response) {
            console.error('HubSpot API Response Status:', error.response.status);
            console.error('HubSpot API Response Body (Detailed Error):');
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
    }
}

testHubSpotContactCreation();