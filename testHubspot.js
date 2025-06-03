const hubspot = require('@hubspot/api-client');
require('dotenv').config(); // Esta línea es CRUCIAL para cargar el .env

const hubspotClientSource = new hubspot.Client({
  accessToken: process.env.HUBSPOT_SOURCE_TOKEN, // Usa HUBSPOT_SOURCE_TOKEN
});

const hubspotClientMirror = new hubspot.Client({
  accessToken: process.env.HUBSPOT_MIRROR_TOKEN, // Usa HUBSPOT_MIRROR_TOKEN
});

const testConnection = async () => {
  try {
    // Estas líneas de consola deben ser exactas para reflejar lo que está en el .env
    console.log('HUBSPOT_SOURCE_TOKEN:', process.env.HUBSPOT_SOURCE_TOKEN);
    console.log('HUBSPOT_MIRROR_TOKEN:', process.env.HUBSPOT_MIRROR_TOKEN);

    await hubspotClientSource.crm.contacts.basicApi.getPage(1);
    console.log('Conexión a Source HubSpot exitosa');
    await hubspotClientMirror.crm.contacts.basicApi.getPage(1);
    console.log('Conexión a Mirror HubSpot exitosa');
  } catch (error) {
    console.error('Error en la conexión:', error.message);
  }
};

testConnection();