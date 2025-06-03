const hubspot = require('@hubspot/api-client');
require('dotenv').config();
const axios = require('axios');

const hubspotClientSource = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });
const hubspotClientMirror = new hubspot.Client({ accessToken: process.env.HUBSPOT_MIRROR_TOKEN });

// Mapeo para almacenar correspondencia entre IDs de Source y Mirror
const companyIdMap = new Map();

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
    // Buscar si la empresa ya existe en Mirror por nombre
    const existingCompany = allMirrorCompanies.find(c => c.properties.name.toLowerCase() === companyName.toLowerCase());

    if (existingCompany) {
      console.log(`Company ${companyName} already exists in Mirror, updating`);
      try {
        await hubspotClientMirror.crm.companies.basicApi.update(existingCompany.id, {
          properties: { name: companyName, hs_lastmodifieddate: company.properties.hs_lastmodifieddate }
        });
        // Mapear el ID de Source al ID de Mirror
        companyIdMap.set(company.id, existingCompany.id);
      } catch (error) {
        console.error(`Error updating company ${companyName}: ${error.message}`);
      }
    } else {
      console.log(`Creating new company ${companyName}`);
      try {
        const newCompany = await hubspotClientMirror.crm.companies.basicApi.create({
          properties: { name: companyName, hs_lastmodifieddate: company.properties.hs_lastmodifieddate }
        });
        // Mapear el ID de Source al nuevo ID de Mirror
        companyIdMap.set(company.id, newCompany.body.id);
      } catch (error) {
        console.error(`Error creating company ${companyName}: ${error.message}`);
      }
    }
    console.log(`Company synced: ${companyName}`);
  }
  console.log(`Companies synced: ${allSourceCompanies.length}`);
  return allSourceCompanies.length;
}

async function syncContacts() {
  console.log('Starting full sync of contacts from Source HubSpot');
  let after = undefined;
  let allSourceContacts = [];

  // Obtener todos los contactos de la cuenta Source
  do {
    const apiResponse = await hubspotClientSource.crm.contacts.basicApi.getPage(100, after, ['email', 'company_name', 'character_id']);
    allSourceContacts = allSourceContacts.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  // Obtener todos los contactos de la cuenta Mirror para comparar
  let allMirrorContacts = [];
  after = undefined;
  do {
    const apiResponse = await hubspotClientMirror.crm.contacts.basicApi.getPage(100, after, ['email', 'character_id', 'company_name']);
    allMirrorContacts = allMirrorContacts.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  for (const contact of allSourceContacts) {
    if (!contact.properties.character_id) {
      console.warn(`Skipping contact ${contact.properties.email} due to missing character_id`);
      continue;
    }

    const contactEmail = contact.properties.email;
    // Buscar si el contacto ya existe en Mirror por email
    const existingContact = allMirrorContacts.find(c => c.properties.email && c.properties.email.toLowerCase() === contactEmail.toLowerCase());

    let contactId;
    if (existingContact) {
      console.log(`Contact ${contactEmail} already exists in Mirror, updating`);
      try {
        await hubspotClientMirror.crm.contacts.basicApi.update(existingContact.id, {
          properties: {
            email: contact.properties.email,
            character_id: contact.properties.character_id,
            company_name: contact.properties.company_name || null
          }
        });
        contactId = existingContact.id;
      } catch (error) {
        console.error(`Error updating contact ${contactEmail}: ${error.message}`);
        continue;
      }
    } else {
      console.log(`Creating new contact ${contactEmail}`);
      try {
        const newContact = await hubspotClientMirror.crm.contacts.basicApi.create({
          properties: {
            email: contact.properties.email,
            character_id: contact.properties.character_id,
            company_name: contact.properties.company_name || null
          }
        });
        contactId = newContact.body.id;
        // Agregar el nuevo contacto a la lista de contactos de Mirror para evitar buscarlo nuevamente
        allMirrorContacts.push({ id: contactId, properties: contact.properties });
      } catch (error) {
        console.error(`Error creating contact ${contactEmail}: ${error.message}`);
        continue;
      }
    }

    // Intentar asociar el contacto con la empresa
    await associateCompany(contactId, contact.properties.company_name);
    console.log(`Contact synced: character_id ${contact.properties.character_id}, email ${contact.properties.email}`);
  }
  console.log(`Contacts synced: ${allSourceContacts.length}`);
}

async function associateCompany(contactId, companyName) {
  if (!companyName) {
    console.log(`No company name provided for contact ${contactId}, skipping association`);
    return;
  }

  try {
    let after = undefined;
    let allCompanies = [];
    do {
      const apiResponse = await hubspotClientMirror.crm.companies.basicApi.getPage(100, after, ['name']);
      allCompanies = allCompanies.concat(apiResponse.results);
      after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
    } while (after);

    const company = allCompanies.find(c => c.properties.name.toLowerCase() === companyName.toLowerCase());
    if (company) {
      await hubspotClientMirror.crm.associations.v4.batchApi.create('contact', 'company', [{
        from: { id: contactId },
        to: { id: company.id },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
      }]);
      console.log(`Contact ${contactId} associated with company ${companyName}`);
    } else {
      console.warn(`Company ${companyName} not found for association with contact ${contactId}, skipping`);
    }
  } catch (error) {
    console.warn(`Failed to associate company ${companyName} with contact ${contactId}: ${error.message}`);
  }
}

async function fullSync() {
  try {
    await syncCompanies();
    await syncContacts();
  } catch (error) {
    console.error('Error during full sync:', error.message);
  }
}

const express = require('express');
const app = express();
app.use(express.json());

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
  fullSync();
});

app.post('/webhook', async (req, res) => {
  const payload = req.body;
  console.log('Processing webhook payload', { payload });
  if (payload.objectType === 'contact') {
    await syncContacts();
  } else if (payload.objectType === 'company') {
    await syncCompanies();
  }
  res.sendStatus(200);
});
