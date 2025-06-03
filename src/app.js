const hubspot = require('@hubspot/api-client');
require('dotenv').config();
const axios = require('axios');

// Inicializa los clientes de HubSpot para la cuenta Origen y Espejo
const hubspotClientSource = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });
const hubspotClientMirror = new hubspot.Client({ accessToken: process.env.HUBSPOT_MIRROR_TOKEN }); // CORRECCIÓN AQUÍ

// Mapeo para almacenar correspondencia entre IDs de Compañías de Source y Mirror
const companyIdMap = new Map();

/**
 * Sincroniza las compañías de la cuenta Source a la cuenta Mirror.
 * Si una compañía ya existe en Mirror (por nombre), se actualiza. De lo contrario, se crea.
 */
async function syncCompanies() {
  console.log('Starting full sync of companies from Source HubSpot');
  let after = undefined;
  let allSourceCompanies = [];

  // Obtener todas las empresas de la cuenta Source
  do {
    const apiResponse = await hubspotClientSource.crm.companies.basicApi.getPage(100, after);
    allSourceCompanies = allSourceCompanies.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  // Obtener todas las empresas de la cuenta Mirror para comparar
  let allMirrorCompanies = [];
  after = undefined;
  do {
    const apiResponse = await hubspotClientMirror.crm.companies.basicApi.getPage(100, after, ['name']);
    allMirrorCompanies = allMirrorCompanies.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  for (const company of allSourceCompanies) {
    const companyName = company.properties.name;
    const sourceCompanyId = company.id;

    if (!companyName) {
      console.warn(`Skipping company with ID: ${sourceCompanyId} due to missing name.`);
      continue;
    }

    try {
      // Buscar compañía existente en Mirror por nombre
      let mirrorCompany = allMirrorCompanies.find(mirrorComp => mirrorComp.properties.name === companyName);

      const companyProperties = {
        name: companyName,
        phone: company.properties.phone || '',
        industry: company.properties.industry || '',
        // Puedes añadir más propiedades de la empresa aquí si lo necesitas
      };

      let upsertedCompany;
      if (mirrorCompany) {
        console.log(`Company ${companyName} already exists in Mirror, updating`);
        upsertedCompany = await hubspotClientMirror.crm.companies.basicApi.update(mirrorCompany.id, {
          properties: companyProperties
        });
      } else {
        console.log(`Creating new company: ${companyName}`);
        upsertedCompany = await hubspotClientMirror.crm.companies.basicApi.create({
          properties: companyProperties
        });
      }
      companyIdMap.set(sourceCompanyId, upsertedCompany.id); // Mapear el ID de Source al ID de Mirror
      console.log(`Company synced: ${companyName}`);

    } catch (error) {
      console.error(`Failed to sync company ${companyName} (ID: ${sourceCompanyId}): ${error.message}`);
      if (error.response && error.response.data) {
        console.error('HubSpot API Error Details:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
  console.log('Finished full sync of companies.');
}

/**
 * Sincroniza los contactos de la cuenta Source a la cuenta Mirror.
 * Utiliza character_id para buscar y actualizar. Si no se encuentra, crea un nuevo contacto.
 */
async function syncContacts() {
  console.log('Starting full sync to Mirror account');
  let after = undefined;
  let allSourceContacts = [];

  // Obtener todos los contactos de la cuenta Source
  do {
    const apiResponse = await hubspotClientSource.crm.contacts.basicApi.getPage(
      100,
      after,
      ['character_id', 'email', 'firstname', 'lastname', 'character_status', 'character_species', 'character_gender', 'associatedcompanyid'] // Asegúrate de pedir 'associatedcompanyid'
    );
    allSourceContacts = allSourceContacts.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  for (const contact of allSourceContacts) {
    const characterId = contact.properties.character_id;
    const email = contact.properties.email;

    // Saltar contactos sin character_id
    if (!characterId) {
      console.warn(`Skipping contact ${contact.properties.firstname || contact.properties.email} (ID: ${contact.id}) due to missing character_id`);
      continue;
    }

    console.log(`Processing contact webhook payload`, { payload: contact.properties }); // Log para ver el payload

    try {
      let mirrorContact = null;
      // Intentar encontrar un contacto existente por character_id
      if (characterId) {
        console.log(`Searching for existing contact by character_id: ${characterId}`);
        const searchResponse = await hubspotClientMirror.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: 'character_id',
              operator: 'EQ',
              value: characterId
            }]
          }],
          properties: ['email', 'firstname', 'lastname', 'character_id', 'character_status', 'character_species', 'character_gender'],
          limit: 1 // Solo necesitamos un resultado
        });
        if (searchResponse.results.length > 0) {
          mirrorContact = searchResponse.results[0];
          console.log(`Contact with character_id ${characterId} found in Mirror: ${mirrorContact.id}`);
        }
      }

      // Si no se encuentra por character_id y el email está disponible, intentar por email
      if (!mirrorContact && email) {
        console.log(`Searching for existing contact by email: ${email}`);
        const searchResponse = await hubspotClientMirror.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: email
            }]
          }],
          properties: ['email', 'firstname', 'lastname', 'character_id', 'character_status', 'character_species', 'character_gender'],
          limit: 1
        });
        if (searchResponse.results.length > 0) {
          mirrorContact = searchResponse.results[0];
          console.log(`Contact with email ${email} found in Mirror: ${mirrorContact.id}`);
        }
      }

      const contactProperties = {
        email: contact.properties.email,
        firstname: contact.properties.firstname,
        lastname: contact.properties.lastname || '',
        character_id: characterId,
        character_status: contact.properties.character_status,
        character_species: contact.properties.character_species,
        character_gender: contact.properties.character_gender
      };

      let upsertedContact;
      if (mirrorContact) {
        // Actualizar contacto existente
        console.log(`Updating contact ${mirrorContact.id} with character_id: ${characterId}`);
        upsertedContact = await hubspotClientMirror.crm.contacts.basicApi.update(mirrorContact.id, {
          properties: contactProperties
        });
        console.log(`Contact updated: ${upsertedContact.id}`);
      } else {
        // Crear nuevo contacto
        console.log(`Creating new contact with character_id: ${characterId}`);
        upsertedContact = await hubspotClientMirror.crm.contacts.basicApi.create({
          properties: contactProperties
        });
        console.log(`Contact created: ${upsertedContact.id}`);
      }

      // Asociar contacto con la compañía si existe la ID de compañía asociada en Source
      const sourceCompanyId = contact.properties.associatedcompanyid; // Esta es la ID de la compañía en la cuenta Source

      if (upsertedContact && sourceCompanyId) {
        await associateContactWithCompany(upsertedContact.id, sourceCompanyId);
      }

    } catch (error) {
      console.error(`Failed to upsert contact and/or create association`, { character_id: characterId, error: error.message, stack: error.stack });
      if (error.response && error.response.data) {
        console.error('HubSpot API Error Details:', JSON.stringify(error.response.data, null, 2));
      }
    }
  }
  console.log('Finished full sync of contacts.');
}

/**
 * Asocia un contacto en la cuenta Mirror con una compañía en la cuenta Mirror.
 * @param {string} contactId - El ID del contacto en la cuenta Mirror.
 * @param {string} sourceCompanyId - El ID de la compañía en la cuenta Source.
 */
async function associateContactWithCompany(contactId, sourceCompanyId) {
  const mirrorCompanyId = companyIdMap.get(sourceCompanyId); // Obtener la ID de la compañía en Mirror desde el mapa

  if (!mirrorCompanyId) {
    console.warn(`No Mirror company ID found for Source company ID ${sourceCompanyId}, skipping association for contact ${contactId}`);
    return;
  }

  try {
    // Definir el tipo de asociación predeterminado para contactos y empresas
    // El associationTypeId 1 es una asociación estándar de HubSpot entre contacto y empresa
    await hubspotClientMirror.crm.associations.v4.batchApi.create('contact', 'company', [{
      from: { id: contactId },
      to: { id: mirrorCompanyId },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
    }]);
    console.log(`Contact ${contactId} associated with company ID ${mirrorCompanyId}`);
  } catch (error) {
    console.warn(`Failed to associate company ID ${mirrorCompanyId} with contact ${contactId}: ${error.message}`);
    if (error.response && error.response.data) {
      console.warn('HubSpot Association API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

/**
 * Ejecuta una sincronización completa de compañías y contactos.
 */
async function fullSync() {
  try {
    await syncCompanies(); // Sincroniza compañías primero para tener los IDs de Mirror
    await syncContacts();  // Luego sincroniza contactos, asociándolos con las compañías ya mapeadas
  } catch (error) {
    console.error('Error during full sync:', error.message);
    if (error.response && error.response.data) {
      console.error('HubSpot API Error Details during full sync:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Configuración del servidor Express para la migración
const express = require('express');
const app = express();
app.use(express.json());

// El servidor escucha en el puerto 3000 (o el que se configure en PORT)
// Y automáticamente inicia la sincronización completa al arrancar
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
  fullSync();
});

// Endpoint para webhooks (si necesitas manejar actualizaciones incrementales en el futuro)
app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  // Aquí iría la lógica para procesar webhooks (por ejemplo, actualizar un solo contacto/empresa)
  // Por ahora, solo es un marcador de posición. La sincronización principal se hace en fullSync().
  res.status(200).send('Webhook received');
});
