const express = require('express');
const router = express.Router();
const hubspot = require('@hubspot/api-client');
const winston = require('winston');
const retry = require('async-retry');
const { body, validationResult } = require('express-validator');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'webhook.log' }),
    new winston.transports.Console(),
  ],
});

const hubspotMirrorClient = new hubspot.Client({
  accessToken: process.env.HUBSPOT_MIRROR_TOKEN,
});

async function upsertContact(data) {
  logger.info('Processing contact webhook payload', { payload: data });

  const characterId = data.character_id;
  const email = data.email;
  if (!characterId || !email) {
    logger.error('Missing required fields in contact webhook', { characterId, email });
    throw new Error('Missing required fields: character_id and email are required');
  }

  const properties = {
    firstname: data.firstname || '',
    lastname: data.lastname || '',
    email,
    character_id: characterId,
    character_status: data.character_status || '',
    character_species: data.character_species || '',
    character_gender: data.character_gender || '',
  };

  let contactId;
  try {
    const result = await retry(
      async () => {
        logger.info('Searching for existing contact', { characterId });
        const searchResponse = await hubspotMirrorClient.crm.contacts.searchApi.doSearch({
          filterGroups: [{ filters: [{ propertyName: 'character_id', operator: 'EQ', value: characterId }] }],
          limit: 1,
        });
        logger.info('Search response', { total: searchResponse.total, results: searchResponse.results.map(r => r.id) });

        if (searchResponse.results.length > 0) {
          const existing = searchResponse.results[0];
          logger.info(`Updating existing contact: ${existing.id}`, { characterId });
          const updateResponse = await hubspotMirrorClient.crm.contacts.basicApi.update(existing.id, { properties });
          contactId = existing.id;
          return 'updated';
        } else {
          logger.info('Creating new contact', { characterId, email });
          const createResponse = await hubspotMirrorClient.crm.contacts.basicApi.create({ properties });
          contactId = createResponse.id;
          logger.info('Contact created', { contactId });
          return 'created';
        }
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (err, attempt) => logger.warn('Retrying contact API call', { attempt, error: err.message }),
      }
    );

    // Create association if company_name is provided
    if (data.company_name) {
      try {
        const companySearch = await hubspotMirrorClient.crm.companies.searchApi.doSearch({
          filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: data.company_name }] }],
          limit: 1,
        });
        if (companySearch.results.length > 0) {
          const companyId = companySearch.results[0].id;
          await hubspotMirrorClient.crm.associations.v4.basicApi.create(
            'contact',
            contactId,
            'company',
            companyId,
            [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 }]
          );
          logger.info('Association created', { contactId, companyId });
        } else {
          logger.warn('Company not found for association', { company_name: data.company_name });
        }
      } catch (error) {
        logger.error('Failed to create contact association', { contactId, company_name: data.company_name, error: error.message });
      }
    }

    return result;
  } catch (error) {
    logger.error('Failed to upsert contact', { characterId, error: error.message, stack: error.stack });
    throw error;
  }
}

async function upsertCompany(data) {
  logger.info('Processing company webhook payload', { payload: data });

  const name = data.name;
  if (!name) {
    logger.error('Missing required field in company webhook', { name });
    throw new Error('Missing required field: name is required');
  }

  const properties = { name };

  try {
    const result = await retry(
      async () => {
        logger.info('Searching for existing company', { name });
        const searchResponse = await hubspotMirrorClient.crm.companies.searchApi.doSearch({
          filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: name }] }],
          limit: 1,
        });
        logger.info('Search response', { total: searchResponse.total, results: searchResponse.results.map(r => r.id) });

        if (searchResponse.results.length > 0) {
          const existing = searchResponse.results[0];
          logger.info(`Updating existing company: ${existing.id}`, { name });
          await hubspotMirrorClient.crm.companies.basicApi.update(existing.id, { properties });
          return 'updated';
        } else {
          logger.info('Creating new company', { name });
          const createResponse = await hubspotMirrorClient.crm.companies.basicApi.create({ properties });
          logger.info('Company created', { companyId: createResponse.id });
          return 'created';
        }
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (err, attempt) => logger.warn('Retrying company API call', { attempt, error: err.message }),
      }
    );
    return result;
  } catch (error) {
    logger.error('Failed to upsert company', { name, error: error.message, stack: error.stack });
    throw error;
  }
}

router.post(
  '/contacts',
  [
    body('character_id').exists().isString().withMessage('character_id is required and must be a string'),
    body('email').isEmail().withMessage('email is required and must be valid'),
  ],
  async (req, res) => {
    logger.info('Received contact webhook request', { body: req.body });
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('Contact webhook validation failed', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const result = await upsertContact(req.body);
      logger.info('Contact webhook processed successfully', { status: result });
      res.status(200).send({ status: result });
    } catch (err) {
      logger.error('Contact webhook error', { error: err.message, stack: err.stack });
      res.status(400).send({ error: err.message });
    }
  }
);

router.post(
  '/companies',
  [body('name').exists().isString().withMessage('name is required and must be a string')],
  async (req, res) => {
    logger.info('Received company webhook request', { body: req.body });
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('Company webhook validation failed', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const result = await upsertCompany(req.body);
      logger.info('Company webhook processed successfully', { status: result });
      res.status(200).send({ status: result });
    } catch (err) {
      logger.error('Company webhook error', { error: err.message, stack: err.stack });
      res.status(400).send({ error: err.message });
    }
  }
);

module.exports = router;
