const express = require('express');
const hubspot = require('@hubspot/api-client');
const winston = require('winston');
const axios = require('axios'); // Asegúrate de que axios esté instalado: npm install axios
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
    // Primero, obtén las asociaciones de la API de Asociaciones v4
    const associationsUrl = `https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies`;
    const associationsResponse = await axios.get(associationsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (!associationsResponse.data.results || associationsResponse.data.results.length === 0) {
      return null; // No hay compañías asociadas
    }

    const companyId = associationsResponse.data.results[0].toObjectId;

    // Luego, obtén los detalles de la compañía
    const companyDetailsUrl = `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name`;
    const companyResponse = await axios.get(companyDetailsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    return companyResponse.data.properties.name || null;
  } catch (err) {
    // Es importante loguear el error para entender por qué falla
    logger.error('Failed to fetch associated company for contact', { contactId, error: err.message, stack: err.stack });
    return null; // Devuelve null si hay un error para no detener la sincronización
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
        // 👉 AÑADIR ESTA VALIDACIÓN AQUÍ
        if (!contact.properties.character_id) {
          logger.warn('Skipping contact due to missing character_id', { hubspotId: contact.id, email: contact.properties.email });
          continue; // Pasa al siguiente contacto en el bucle
        }

        try {
          // Asegúrate de que contact.id está presente antes de llamar a getCompanyNameForContact
          const company_name = contact.id
            ? await getCompanyNameForContact(contact.id, process.env.HUBSPOT_SOURCE_TOKEN)
            : null;

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

    // Sync companies (esta sección no necesita cambios en este momento)
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
