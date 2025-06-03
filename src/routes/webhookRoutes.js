const express = require('express');
const router = express.Router();
const hubspot = require('@hubspot/api-client');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'webhook.log' }),
    new winston.transports.Console(), // Also log to console for real-time debugging
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

  try {
    logger.info('Searching for existing contact', { characterId });
    const searchResponse = await hubspotMirrorClient.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters: [{ propertyName: 'character_id', operator: 'EQ', value: characterId }] }],
      limit: 1,
    });
    logger.info('Search response', { total: searchResponse.total, results: searchResponse.results.map(r => r.id) });

    if (searchResponse.results.length > 0) {
      const existing = searchResponse.results[0];
      logger.info(`Updating existing contact: ${existing.id}`, { characterId });
      await hubspotMirrorClient.crm.contacts.basicApi.update(existing.id, { properties });
      return 'updated';
    } else {
      logger.info('Creating new contact', { characterId, email });
      const createResponse = await hubspotMirrorClient.crm.contacts.basicApi.create({ properties });
      logger.info('Contact created', { contactId: createResponse.id });
      return 'created';
    }
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
  } catch (error) {
    logger.error('Failed to upsert company', { name, error: error.message, stack: error.stack });
    throw error;
  }
}

router.post('/contacts', async (req, res) => {
  logger.info('Received contact webhook request', { body: req.body });
  try {
    const result = await upsertContact(req.body);
    logger.info('Contact webhook processed successfully', { status: result });
    res.status(200).send({ status: result });
  } catch (err) {
    logger.error('Contact webhook error', { error: err.message, stack: err.stack });
    res.status(400).send({ error: err.message });
  }
});

router.post('/companies', async (req, res) => {
  logger.info('Received company webhook request', { body: req.body });
  try {
    const result = await upsertCompany(req.body);
    logger.info('Company webhook processed successfully', { status: result });
    res.status(200).send({ status: result });
  } catch (err) {
    logger.error('Company webhook error', { error: err.message, stack: err.stack });
    res.status(400).send({ error: err.message });
  }
});

module.exports = router;
