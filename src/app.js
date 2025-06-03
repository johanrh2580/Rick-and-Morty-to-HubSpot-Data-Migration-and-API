const express = require('express');
const hubspot = require('@hubspot/api-client');
const winston = require('winston');
const axios = require('axios');
require('dotenv').config();

const { router: webhookRouter, upsertContact, upsertCompany } = require('./routes/webhookRoutes');

const app = express();
const port = process.env.PORT || 3000;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'app.log' }),
    new winston.transports.Console(),
  ],
});

app.use(express.json());
app.use('/webhooks', webhookRouter);

// 👉 NUEVA FUNCIÓN: obtiene el nombre de la compañía asociada a un contacto usando REST + axios
async function getCompanyNameForContact(contactId, token) {
  try {
    const url = `https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.data.results || response.data.results.length === 0) return null;

    const companyId = response.data.results[0].toObjectId;
    const companyDetailsUrl = `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name`;

    const companyResponse = await axios.get(companyDetailsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    return companyResponse.data.properties.name || null;
  } catch (err) {
    logger.error('Failed to fetch associated company', { contactId, error: err.message });
    return null;
  }
}

app.post('/sync', async (req, res) => {
  logger.info('Starting full sync to Mirror account');

  const sourceClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });

  try {
    // Sync contacts
    let contactsSynced = 0;
    let after = undefined;

    do {
      logger.info('Fetching batch of contacts from Source HubSpot', { after });

      const contactsResponse = await sourceClient.crm.contacts.basicApi.getPage(100, after, [
        'character_id',
        'email',
        'firstname',
        'lastname',
        'character_status',
        'character_species',
        'character_gender',
      ]);

      for (const contact of contactsResponse.results) {
        try {
          const company_name = await getCompanyNameForContact(contact.id, process.env.HUBSPOT_SOURCE_TOKEN);

          const contactData = {
            ...contact.properties,
            company_name
          };

          await upsertContact(contactData);
          contactsSynced++;

          logger.info('Contact synced', {
            character_id: contact.properties.character_id,
            hubspotId: contact.id
          });
        } catch (error) {
          logger.error('Failed to sync contact', {
            character_id: contact.properties.character_id,
            error: error.message,
            stack: error.stack
          });
        }
      }

      after = contactsResponse.paging?.next?.after;
    } while (after);

    logger.info('Contacts synced', { count: contactsSynced });

    // Sync companies
    let companiesSynced = 0;
    after = undefined;

    do {
      logger.info('Fetching batch of companies from Source HubSpot', { after });

      const companiesResponse = await sourceClient.crm.companies.basicApi.getPage(100, after, ['name']);

      for (const company of companiesResponse.results) {
        try {
          await upsertCompany(company.properties);
          companiesSynced++;

          logger.info('Company synced', {
            name: company.properties.name,
            hubspotId: company.id
          });
        } catch (error) {
          logger.error('Failed to sync company', {
            name: company.properties.name,
            error: error.message,
            stack: error.stack
          });
        }
      }

      after = companiesResponse.paging?.next?.after;
    } while (after);

    logger.info('Companies synced', { count: companiesSynced });

    res.status(200).json({ message: `Synced ${contactsSynced} contacts and ${companiesSynced} companies` });
  } catch (error) {
    logger.error('Sync failed critically', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
