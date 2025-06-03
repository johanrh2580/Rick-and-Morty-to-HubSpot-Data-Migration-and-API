const hubspot = require('@hubspot/api-client');
require('dotenv').config();
const axios = require('axios');

const hubspotClientSource = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });
const hubspotClientMirror = new hubspot.Client({ accessToken: process.env.HUBSPOT_MIRROR_TOKEN });

async function syncCompanies() {
  console.log('Starting full sync of companies from Source HubSpot');
  let after = undefined;
  let allCompanies = [];

  do {
    const apiResponse = await hubspotClientSource.crm.companies.basicApi.getPage(100, after);
    allCompanies = allCompanies.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  for (const company of allCompanies) {
    try {
      const existingCompany = await hubspotClientMirror.crm.companies.basicApi.getById(company.id, ['name']);
      console.log(`Company ${company.properties.name} already exists, updating`);
      await hubspotClientMirror.crm.companies.basicApi.update(company.id, {
        properties: { name: company.properties.name, hs_lastmodifieddate: company.properties.hs_lastmodifieddate }
      });
    } catch (error) {
      if (error.status === 404) {
        console.log(`Creating new company ${company.properties.name}`);
        await hubspotClientMirror.crm.companies.basicApi.create({
          properties: { name: company.properties.name, hs_lastmodifieddate: company.properties.hs_lastmodifieddate }
        });
      }
    }
    console.log(`Company synced: ${company.properties.name}`);
  }
  console.log(`Companies synced: ${allCompanies.length}`);
  return allCompanies.length;
}

async function syncContacts() {
  console.log('Starting full sync of contacts from Source HubSpot');
  let after = undefined;
  let allContacts = [];

  do {
    const apiResponse = await hubspotClientSource.crm.contacts.basicApi.getPage(100, after, ['email', 'company_name', 'character_id']);
    allContacts = allContacts.concat(apiResponse.results);
    after = apiResponse.paging ? apiResponse.paging.next.after : undefined;
  } while (after);

  for (const contact of allContacts) {
    if (!contact.properties.character_id) {
      console.warn(`Skipping contact ${contact.properties.email} due to missing character_id`);
      continue;
    }

    try {
      const existingContact = await hubspotClientMirror.crm.contacts.basicApi.getById(contact.id, ['email', 'character_id', 'company_name']);
      console.log(`Updating existing contact: ${contact.id}`);
      await hubspotClientMirror.crm.contacts.basicApi.update(contact.id, {
        properties: {
          email: contact.properties.email,
          character_id: contact.properties.character_id,
          company_name: contact.properties.company_name || null
        }
      });
    } catch (error) {
      if (error.status === 404) {
        console.log(`Creating new contact ${contact.properties.email}`);
        const newContact = await hubspotClientMirror.crm.contacts.basicApi.create({
          properties: {
            email: contact.properties.email,
            character_id: contact.properties.character_id,
            company_name: contact.properties.company_name || null
          }
        });
        await associateCompany(newContact.id, contact.properties.company_name);
      }
    }
    console.log(`Contact synced: character_id ${contact.properties.character_id}, hubspotId ${contact.id}`);
  }
  console.log(`Contacts synced: ${allContacts.length}`);
}

async function associateCompany(contactId, companyName) {
  if (!companyName) return;

  try {
    const companies = await hubspotClientMirror.crm.companies.basicApi.getPage(100, undefined, ['name']);
    const company = companies.results.find(c => c.properties.name === companyName);
    if (company) {
      await hubspotClientMirror.crm.companies.associationsApi.create(
        company.id,
        'company_to_contact',
        contactId,
        { associationTypeId: 1 }
      );
      console.log(`Contact ${contactId} associated with company ${companyName}`);
    } else {
      console.warn(`Company ${companyName} not found for association, skipping`);
    }
  } catch (error) {
    console.warn(`Failed to associate company ${companyName} with contact ${contactId}, skipping: ${error.message}`);
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
    await syncContacts(); // Opcional: solo sincronizar el contacto específico
  } else if (payload.objectType === 'company') {
    await syncCompanies(); // Opcional: solo sincronizar la empresa específica
  }
  res.sendStatus(200);
});
