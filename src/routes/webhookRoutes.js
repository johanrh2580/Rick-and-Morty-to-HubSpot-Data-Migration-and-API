const express = require('express');
const router = express.Router();
const hubspot = require('@hubspot/api-client');
const winston = require('winston');
const retry = require('async-retry');
const { body, validationResult } = require('express-validator');

require('dotenv').config();

// Configure Winston logger for structured logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'webhook.log' }), // Log to file
    new winston.transports.Console(), // Also log to console
  ],
});

// Initialize HubSpot client for mirror account operations
const hubspotMirrorClient = new hubspot.Client({
  accessToken: process.env.HUBSPOT_MIRROR_TOKEN,
});

/**
 * Handles contact upsert operations in HubSpot mirror account
 * @param {Object} data - Contact data including required character_id and email
 * @returns {Promise<string>} - Result of operation ('created' or 'updated')
 * @throws {Error} - If required fields are missing or API operations fail
 */
async function upsertContact(data) {
  logger.info('Processing contact webhook payload', { payload: data });

  // Validate required fields
  const characterId = data.character_id;
  const email = data.email;
  if (!characterId || !email) {
    logger.error('Missing required fields in contact data', { characterId, email });
    throw new Error('Both character_id and email are required');
  }

  // Prepare HubSpot contact properties
  const properties = {
    firstname: data.firstname || '',
    lastname: data.lastname || '',
    email: email,
    character_id: characterId,
    character_status: data.character_status || '',
    character_species: data.character_species || '',
    character_gender: data.character_gender || '',
  };

  let contactId;
  try {
    const action = await retry(
      async () => {
        // Check for existing contact by character_id
        logger.info('Searching for existing contact', { characterId });
        const searchResponse = await hubspotMirrorClient.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: 'character_id',
              operator: 'EQ',
              value: characterId
            }]
          }],
          limit: 1,
        });

        if (searchResponse.results.length > 0) {
          // Update existing contact
          const existing = searchResponse.results[0];
          logger.info(`Updating contact ${existing.id}`);
          await hubspotMirrorClient.crm.contacts.basicApi.update(existing.id, { properties });
          contactId = existing.id;
          return 'updated';
        } else {
          // Create new contact
          logger.info('Creating new contact', { characterId, email });
          const createResponse = await hubspotMirrorClient.crm.contacts.basicApi.create({ properties });
          contactId = createResponse.id;
          logger.info('Contact created successfully', { contactId });
          return 'created';
        }
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (err, attempt) => logger.warn(`Retry attempt ${attempt}`, { error: err.message }),
      }
    );

    // Handle company association if company_name is provided
    if (data.company_name && contactId) {
      await handleCompanyAssociation(contactId, data.company_name);
    }

    return action;
  } catch (error) {
    logger.error('Contact upsert operation failed', { 
      characterId,
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Handles company association for a contact
 * @param {string} contactId - HubSpot contact ID
 * @param {string} companyName - Company name to associate with
 */
async function handleCompanyAssociation(contactId, companyName) {
  try {
    logger.info('Attempting company association', { contactId, companyName });
    const companySearch = await hubspotMirrorClient.crm.companies.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'EQ',
          value: companyName
        }]
      }],
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
      logger.info('Association created successfully', { contactId, companyId });
    } else {
      logger.warn('Company not found for association', { companyName });
    }
  } catch (error) {
    logger.error('Company association failed', {
      contactId,
      companyName,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Handles company upsert operations in HubSpot mirror account
 * @param {Object} data - Company data including required name
 * @returns {Promise<string>} - Result of operation ('created' or 'updated')
 * @throws {Error} - If required field is missing or API operations fail
 */
async function upsertCompany(data) {
  logger.info('Processing company webhook payload', { payload: data });

  const name = data.name;
  if (!name) {
    logger.error('Missing required field in company data');
    throw new Error('Company name is required');
  }

  try {
    const action = await retry(
      async () => {
        // Check for existing company by name
        logger.info('Searching for existing company', { name });
        const searchResponse = await hubspotMirrorClient.crm.companies.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: 'name',
              operator: 'EQ',
              value: name
            }]
          }],
          limit: 1,
        });

        if (searchResponse.results.length > 0) {
          // Update existing company
          const existing = searchResponse.results[0];
          logger.info(`Updating company ${existing.id}`);
          await hubspotMirrorClient.crm.companies.basicApi.update(existing.id, { properties: { name } });
          return 'updated';
        } else {
          // Create new company
          logger.info('Creating new company', { name });
          const createResponse = await hubspotMirrorClient.crm.companies.basicApi.create({ properties: { name } });
          logger.info('Company created successfully', { companyId: createResponse.id });
          return 'created';
        }
      },
      {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (err, attempt) => logger.warn(`Retry attempt ${attempt}`, { error: err.message }),
      }
    );
    return action;
  } catch (error) {
    logger.error('Company upsert operation failed', {
      name,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Contact webhook endpoint with validation
router.post(
  '/contacts',
  [
    body('character_id').exists().isString().withMessage('Valid character_id required'),
    body('email').isEmail().withMessage('Valid email required'),
  ],
  async (req, res) => {
    logger.info('Contact webhook request received');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('Validation errors', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const result = await upsertContact(req.body);
      logger.info('Contact webhook processed', { status: result });
      res.status(200).send({ status: result });
    } catch (err) {
      logger.error('Contact webhook processing failed', { error: err.message });
      res.status(400).send({ error: err.message });
    }
  }
);

// Company webhook endpoint with validation
router.post(
  '/companies',
  [body('name').exists().isString().withMessage('Valid company name required')],
  async (req, res) => {
    logger.info('Company webhook request received');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('Validation errors', { errors: errors.array() });
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const result = await upsertCompany(req.body);
      logger.info('Company webhook processed', { status: result });
      res.status(200).send({ status: result });
    } catch (err) {
      logger.error('Company webhook processing failed', { error: err.message });
      res.status(400).send({ error: err.message });
    }
  }
);

module.exports = {
  router,
  upsertContact,
  upsertCompany,
};
