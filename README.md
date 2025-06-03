# Backend Solution: Rick & Morty Data Migration and Synchronization to HubSpot

## Project Overview

This project implements a robust and efficient backend solution, developed in Node.js, designed to manage data migration from the public Rick & Morty API to a HubSpot instance (referred to as the "Mirror" or destination). Additionally, the solution integrates the capability to interact with a second HubSpot instance ("Source") for reading pre-existing data, enriching the company and contact synchronization process.

The primary focus of this solution is the initial data migration, conceived as a unidirectional, one-time transfer process. This process ensures idempotency and data integrity by mapping and replicating key entities:

* Rick & Morty Characters are mapped as Contacts in HubSpot.  
* Locations associated with these characters are mapped as Companies in HubSpot.  
* Logical associations are established between Contacts and Companies within the HubSpot Mirror instance.

## Implemented Features

The application executes the following essential functionalities:

* Conditional Data Extraction from Rick & Morty:  
  * Collects characters from the Rick & Morty API, applying a selection criterion: all characters whose `ID` is a prime number are included, along with `ID` number 1 (corresponding to Rick Sanchez).  
  * Origin locations associated with the selected characters are also extracted for processing as companies.  
* Intelligent Entity Synchronization in HubSpot (Upsert Logic):  
  * Company Synchronization: Reads and processes companies from the HubSpot Source account and synchronizes them with the Mirror account. The "upsert" (update or insert) logic ensures that if a company already exists in the Mirror account (identified by its `name`), its information is updated; otherwise, a new entry is created.  
  * Contact Synchronization: Retrieves contacts from the HubSpot Source account. For each qualified Rick & Morty character, a search is performed in the Mirror account using a custom property (`character_id`) and, as a fallback, the character's `email` (if available). If the contact is found, it is updated; otherwise, it is created.  
* Association Establishment: Migrated contacts are automatically associated with their respective companies in the HubSpot Mirror account, based on the character's origin location. This process uses an internal ID mapping to ensure correct linking.  
* Error Handling and Retries:  
  * A retry strategy with exponential backoff is implemented for calls to external APIs (both Rick & Morty and HubSpot), improving the application's resilience against transient network failures or rate limits.  
  * Specific handling for HTTP 429 (Rate Limit) responses from HubSpot, with dynamic waits.  
* Data Validation and Cleaning: Includes logic to validate and clean data (e.g., email format) before sending it to HubSpot.  
* Detailed Logging: The application generates comprehensive logs in the console, providing full visibility into migration progress, create/update operations, established associations, warnings (e.g., contacts without `character_id`), and detected errors.


## System Architecture

The solution architecture is visualized below:  

* System Architecture Diagram (./Diagram/architecture.png)  
* Fig 3. Data flow between Rick & Morty API, Node.js backend, and HubSpot accounts*

Key components:  
- **Prime Number Filter**: Selects characters (ID=1 + primes)  
- **Property Mapper**: Converts API fields → HubSpot properties  
- **Webhooks**: Handle real-time updates from HubSpot Source  


##  Project Structure

The project is organized in a modular directory structure to facilitate understanding, maintenance, and scalability, adhering to the principles of separation of concerns. Below is the directory structure:

backend-developer-test/

├── node\_modules/                  \# Node.js dependencies directory.
├── .env.example                    \# Example file for environment variable configuration.
├── .gitignore                      \# Git configuration to ignore specific files and directories.
├── package.json                    \# Project manifest and list of dependencies.
├── package-lock.json               \# Exact versions of dependencies.
├── Diagram/
    ├── architecture.png            \# Exported from Mermaid/Figma
├── screenshots/
    ├── console-output.png          \# Capture migration logs
    ├── hubspot-contacts.png        \# View contacts in HubSpot
    └── hubspot-companies.png       \# View companies
├── testHubspot.js                  \# (Optional) File for HubSpot-specific test scripts or auxiliary scripts.
└── src/                            \# Main source code directory for the application.
    ├── app.js                      \# Main Module: Application orchestration and core migration logic.
    ├── clients/                    \# API clients for interacting with external services.
    │   └── rickAndMortyClient.js   \# Dedicated client for the Rick & Morty API.
    ├── routes/                     \# API route definitions and webhook handling.
    │   └── webhookRoutes.js        \# Routes and logic for receiving HubSpot webhooks.
    ├── services/                   \# Contains business services and modular logic (see important note below).
    │   └── hubspotMigrationService.js \# Migration Service (with commented content).
    └── utils/                      \# Utility modules and helper functions.
        └── math.js                 \# Mathematical utilities (e.g., for prime number detection).

### Important Note: `src/services/hubspotMigrationService.js`

The `src/services/` directory and the `hubspotMigrationService.js` file were included in the project structure in accordance with the organization guidelines proposed in the challenge. However, for this particular project, and in the interest of clarity and ease of evaluation of the complete migration flow within the context of this test, the core migration logic (`fullSync`, `syncCompanies`, `syncContacts`, and `associateContactWithCompany`) has been consolidated directly within `src/app.js`.

This decision was made to offer a more linear and accessible view of the migration process from the application's main entry point. The `hubspotMigrationService.js` file remains in the repository (with all its content commented out) as a demonstration of understanding modularization principles and to maintain consistency with the suggested structure. It is crucial to note that this file does not actively participate in the current execution of the migration, serving solely as a structural placeholder.

##  Key Technologies

* Node.js: Server-side JavaScript runtime environment.  
* Express.js: Framework for building the REST API.  
* @hubspot/api-client: Official HubSpot SDK for Node.js, facilitating programmatic interaction with HubSpot APIs.  
* Axios: Promise-based HTTP client, used for interactions with the Rick & Morty API and for direct calls to the HubSpot REST API (when the SDK did not offer specific functionality or for optimization).  
* Dotenv: Essential module for secure and flexible environment variable management.  
* Winston: Advanced logging library, employed for structured and efficient log generation.  
* Async-retry: Used to implement exponential backoff retry logic for external API calls, enhancing system resilience.  
* Express-validator: Middleware for validating incoming HTTP request data, applied to webhook endpoints.

##  Installation and Configuration

Follow these steps to set up and run the project locally:

 ## Prerequisites

 **Accounts & Permissions**  
- Two HubSpot accounts (Source and Mirror) with:  
  - Private Apps enabled (for API access)  
  - Custom properties created for:  
    - Contacts: `character_id`, `status_character`, `character_species`, `character_gender`  
    - Companies: `location_id`, `location_type`, `dimension`  

 **Development Environment**  
- Node.js v16+  
- Git  
- Terminal/CLI access  

## Installation and Configuration

1. Clone the repository:  
   git clone https://github.com/johanrh2580/Rick-and-Morty-to-HubSpot-Data-Migration-and-API.git
   cd backend-developer-test

2. Install Dependencies:

npm install

3. Configure Environment Variables:  
   * Create a file named `.env` in the root of your project.  
   * Copy the content from the `.env.example` file to your new `.env` file.  
   * Replace the placeholder values with your actual HubSpot access tokens and desired port.

**HUBSPOT_SOURCE_TOKEN=your_hubspot_source_private_access_token**
**HUBSPOT_MIRROR_TOKEN=your_hubspot_mirror_private_access_token**
**PORT=3000**

* Security Warning: The `.env` file is configured to be ignored by Git via `.gitignore`, ensuring your credentials are not exposed in the repository.

## Application Execution

To start the application and activate the migration process:

1. Open your terminal in the project's root directory (`backend-developer-test/`).  
2.  Execute the following command:

   *node src/app.js*

   (Alternatively, if a `start` script has been configured in `package.json`, you could use `npm start`).

Startup Behavior:

* Upon server startup (which will listen by default on port 3000, if no other `PORT` variable is specified), the `fullSync()` function will automatically execute.  
* The complete company and contact migration and synchronization process will begin, and logs will detail each phase in the console.  
* Once the initial migration has concluded, the server will remain active and listening on the configured port (e.g., `http://localhost:3000`), ready to receive webhook requests or any other added functionality.

 Key Design Decisions and Rationale

The following decisions were made to optimize the project's functionality and clarity within the context of the test:

* Migration Trigger (`fullSync`):  
  * The automatic execution of `fullSync()` upon server startup reflects a "one-time" migration approach, where the main process completes as soon as the application is operational. This ensures data transfer as soon as the application is live.  
* Webhook Endpoint (`/webhook`):  
  * The `POST /webhook` endpoint has been included as a functional placeholder for future continuous integration. Although not used for the initial migration, its presence demonstrates readiness for future incremental and real-time synchronization, where HubSpot could notify the application of changes.  
* HubSpot Entity "Upsert" Logic:  
  * For companies, identification and "upsert" are based on the `name`, ensuring uniqueness and updating of existing records.  
  * For contacts, a custom property (`character_id`) is prioritized for precise identification with Rick & Morty characters. `email` acts as a secondary search key for flexibility.  
* Error Handling and Resilience:  
  * The implementation of `async-retry` with exponential backoff is crucial for stability in network environments and with external APIs that may experience latency or rate limits. This significantly enhances migration robustness.  
* HubSpot Custom Properties:  
  * The existence and prior configuration of custom properties in HubSpot (e.g., `character_id`, `character_gender`, `character_species`, `character_status`) in the Mirror account are assumed for accurate mapping of character attributes.

## Expected Results Visualization

After successful execution, you should see:

## Console Output
* Migration Logs(./screenshots/console-output.png)
* Fig 1. Console showing migration progress with timestamps and success/error messages*
* HubSpot Contacts(./screenshots/hubspot-contacts.png)
* HubSpot Companies(./screenshots/hubspot-companies.png) 
* Fig 2. Migrated data in HubSpot Mirror account (Left: Contacts as characters, Right: Companies as locations)*

> **Note**: Actual screenshots are stored in `/screenshots/` directory. Paths above are examples.

## Implementation Verification

Once the application has completed its migration cycle, you can verify the results in your HubSpot Mirror account:

* Contacts: Access the Contacts section to confirm the creation and updating of records corresponding to Rick & Morty characters.  
* Companies: Review the Companies section to verify the correct migration and updating of locations.  
* Associations: Inspect any migrated Contact to ensure it is correctly associated with its origin Company (location) according to the defined logic.  
* Render Logs: Check the logs of your deployed service on Render to confirm the start of `fullSync` and, subsequently, the successful reception and processing of webhooks when making changes in the Source account.

## Developed by: Johan Felipe Rodriguez Herrera

