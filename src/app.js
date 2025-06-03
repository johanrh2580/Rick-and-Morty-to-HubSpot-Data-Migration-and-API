const express = require('express');
const hubspot = require('@hubspot/api-client');
const winston = require('winston');

// Carga las variables de entorno desde el archivo .env
// Esto debe hacerse al principio del archivo principal de tu aplicación
require('dotenv').config();

// Importa el router y las funciones upsert desde webhookRoutes.js
// Asegúrate de que webhookRoutes.js exporta estas funciones como un objeto.
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

app.use(express.json()); // Middleware para parsear JSON en las solicitudes

// Montar el router de webhooks. Los webhooks estarán disponibles bajo la ruta /webhooks/
// Por ejemplo, si en webhookRoutes.js tienes un router.post('/contacts', ...),
// aquí será accesible en /webhooks/contacts.
app.use('/webhooks', webhookRouter);

// Endpoint para sincronización manual de contactos y empresas
app.post('/sync', async (req, res) => {
  logger.info('Starting full sync to Mirror account');

  // Inicializa los clientes de HubSpot dentro del endpoint para asegurar que los tokens se leen
  // cada vez que se llama al endpoint (útil si los tokens pueden cambiar dinámicamente).
  const sourceClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_SOURCE_TOKEN });
  const mirrorClient = new hubspot.Client({ accessToken: process.env.HUBSPOT_MIRROR_TOKEN }); // Aunque mirrorClient no se usa directamente aquí, se pasa a upsert functions.

  try {
    // Sincronizar contactos
    let contactsSynced = 0;
    let after = undefined; // Para paginación
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
          const associations = await sourceClient.crm.associations.getAll(
            'contact',
            contact.id,
            'company'
          );

          
          let company_name = null;
          if (associations.results.length > 0) {
            const companyId = associations.results[0].id;
            const company = await sourceClient.crm.companies.basicApi.getById(companyId, ['name']);
            company_name = company.properties.name;
          }


          // Preparar los datos del contacto incluyendo el nombre de la compañía
          const contactData = {
            ...contact.properties, // Copia todas las propiedades existentes del contacto
            company_name: company_name // Añade la propiedad company_name
          };

          // Reutilizar la función upsertContact del módulo de webhooks
          await upsertContact(contactData);
          contactsSynced++;
          logger.info('Contact synced', { character_id: contact.properties.character_id, hubspotId: contact.id });
        } catch (error) {
          logger.error('Failed to sync contact', { character_id: contact.properties.character_id, error: error.message, stack: error.stack });
        }
      }
      after = contactsResponse.paging?.next?.after; // Preparar para la siguiente página
    } while (after); // Continuar mientras haya más páginas
    logger.info('Contacts synced', { count: contactsSynced });

    // Sincronizar empresas
    let companiesSynced = 0;
    after = undefined; // Reiniciar para paginación de empresas
    do {
      logger.info('Fetching batch of companies from Source HubSpot', { after });
      const companiesResponse = await sourceClient.crm.companies.basicApi.getPage(100, after, ['name']);
      for (const company of companiesResponse.results) {
        try {
          // Reutilizar la función upsertCompany del módulo de webhooks
          await upsertCompany(company.properties);
          companiesSynced++;
          logger.info('Company synced', { name: company.properties.name, hubspotId: company.id });
        } catch (error) {
          logger.error('Failed to sync company', { name: company.properties.name, error: error.message, stack: error.stack });
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

// Iniciar el servidor
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
