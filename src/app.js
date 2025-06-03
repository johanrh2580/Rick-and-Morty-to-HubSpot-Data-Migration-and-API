const express = require('express');
const hubspot = require('@hubspot/api-client');
const winston = require('winston');
const webhookRoutes = require('backend-developer-test/src/routes/webhookRoutes');


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

// Routes
app.use('./routes/webhookRoutes', webhookRoutes);


// Sync endpoint to manually sync all contacts and companies
app.post('/sync', async (req, res) => {
  logger.info('Starting full sync to Mirror account');
  const sourceClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });
  const mirrorClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_MIRROR_TOKEN });

  try {
    // Sync contacts
    let contactsSynced = 0;
    let after = undefined;
    do {
      logger.info('Fetching batch of contacts', { after });
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
          // Check for associated company
          const associations = await sourceClient.crm.associations.v4.basicApi.get('contact', contact.id, 'company');
          let company_name = null;
          if (associations.results.length > 0) {
            const companyId = associations.results[0].toObjectId;
            const company = await sourceClient.crm.companies.basicApi.getById(companyId, ['name']);
            company_name = company.properties.name;
          }
          const contactData = { ...contact.properties, company_name };
          await upsertContact(contactData); // Reuse upsertContact from webhookRoutes
          contactsSynced++;
          logger.info('Contact synced', { character_id: contact.properties.character_id });
        } catch (error) {
          logger.error('Failed to sync contact', { character_id: contact.properties.character_id, error: error.message });
        }
      }
      after = contactsResponse.paging?.next?.after;
    } while (after);
    logger.info('Contacts synced', { count: contactsSynced });

    // Sync companies
    let companiesSynced = 0;
    after = undefined;
    do {
      logger.info('Fetching batch of companies', { after });
      const companiesResponse = await sourceClient.crm.companies.basicApi.getPage(100, after, ['name']);
      for (const company of companiesResponse.results) {
        try {
          await upsertCompany(company.properties); // Reuse upsertCompany from webhookRoutes
          companiesSynced++;
          logger.info('Company synced', { name: company.properties.name });
        } catch (error) {
          logger.error('Failed to sync company', { name: company.properties.name, error: error.message });
        }
      }
      after = companiesResponse.paging?.next?.after;
    } while (after);
    logger.info('Companies synced', { count: companiesSynced });

    res.status(200).json({ message: `Synced ${contactsSynced} contacts and ${companiesSynced} companies` });
  } catch (error) {
    logger.error('Sync failed', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// Re-export upsert functions for use in /sync endpoint
const { upsertContact, upsertCompany } = require('/routes/webhookRoutes');

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
