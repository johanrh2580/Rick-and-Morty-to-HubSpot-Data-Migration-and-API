
const express = require('express');
const router = express.Router();
const hubspot = require('@hubspot/api-client');

// Crear cliente para la cuenta espejo
const hubspotMirrorClient = new hubspot.Client({
  accessToken: process.env.HUBSPOT_MIRROR_TOKEN
});

/**
 * Utilidad para crear o actualizar contacto en cuenta espejo
 */
async function upsertContact(data) {
  const characterId = data.character_id;
  const email = data.email;
  if (!characterId || !email) throw new Error('Missing required fields');

  // Buscar por character_id
  const searchResponse = await hubspotMirrorClient.crm.contacts.searchApi.doSearch({
    filterGroups: [{
      filters: [{ propertyName: 'character_id', operator: 'EQ', value: characterId }]
    }],
    limit: 1
  });

  const properties = {
    firstname: data.firstname,
    lastname: data.lastname,
    email: data.email,
    character_id: data.character_id,
    character_status: data.character_status || '',
    character_species: data.character_species || '',
    character_gender: data.character_gender || ''
  };

  if (searchResponse.results.length > 0) {
    const existing = searchResponse.results[0];
    await hubspotMirrorClient.crm.contacts.basicApi.update(existing.id, { properties });
    return 'updated';
  } else {
    await hubspotMirrorClient.crm.contacts.basicApi.create({ properties });
    return 'created';
  }
}

/**
 * Utilidad para crear o actualizar empresa en cuenta espejo
 */
async function upsertCompany(data) {
  const name = data.name;
  if (!name) throw new Error('Missing company name');

  const searchResponse = await hubspotMirrorClient.crm.companies.searchApi.doSearch({
    filterGroups: [{
      filters: [{ propertyName: 'name', operator: 'EQ', value: name }]
    }],
    limit: 1
  });

  const properties = { name };

  if (searchResponse.results.length > 0) {
    const existing = searchResponse.results[0];
    await hubspotMirrorClient.crm.companies.basicApi.update(existing.id, { properties });
    return 'updated';
  } else {
    await hubspotMirrorClient.crm.companies.basicApi.create({ properties });
    return 'created';
  }
}

// POST /webhook/contacts
router.post('/contacts', async (req, res) => {
  try {
    const result = await upsertContact(req.body);
    res.status(200).send({ status: result });
  } catch (err) {
    console.error('Contact Webhook Error:', err.message);
    res.status(400).send({ error: err.message });
  }
});

// POST /webhook/companies
router.post('/companies', async (req, res) => {
  try {
    const result = await upsertCompany(req.body);
    res.status(200).send({ status: result });
  } catch (err) {
    console.error('Company Webhook Error:', err.message);
    res.status(400).send({ error: err.message });
  }
});

module.exports = router;
