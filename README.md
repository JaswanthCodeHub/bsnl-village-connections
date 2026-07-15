# BSNL Connection Manager

A web application designed to manage BSNL FTTH connection records with search, filter, and bulk Excel import/export features.

## Getting Started (Local Development)

1. Open a terminal in this directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```
4. Open your browser and navigate to `http://localhost:3000`.

## Key Features

- **Manage Connections**: Add, edit, or delete BSNL customer connections.
- **Search & Filter**: Search by VLAN, Name, Landline, or User ID. Filter customers by specific villages/routes.
- **Excel Import (Replace)**: Easily import Excel (`.xlsx` or `.csv`) files to replace records for a specific area/route without affecting other areas.
- **Excel Export**: Download all connections or filtered connections as a beautifully formatted Excel sheet.
- **JSON Backup**: Download a local JSON backup of all records in one click.

## Supported Excel Column Headers

During Excel import, the app automatically matches column headers (case-insensitive) like:
- **VLAN No**: `VLAN NO`, `VLAN NUMBER`, `VLAN`
- **Customer Name**: `NAME`, `CUSTOMER NAME`, `SUBSCRIBER NAME` (Required)
- **Landline No**: `LANDLINE NO`, `CONNECTION NUMBER`, `NUMBER`
- **User ID**: `USER ID`, `USERID`, `BSNL USER ID`
- **Notes**: `NOTES`, `REMARKS`, `COMMENT`

*Note: At least the Customer Name column must have a value to import successfully. Other fields can be updated later via the web interface.*

## Database

- The project uses **MongoDB Atlas** as its cloud database for production deployments.
- For local testing, ensure your `MONGODB_URI` environment variable is configured.
