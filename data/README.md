# Data Directory

This folder is used by `migrate.js` to read `connections.json` for one-time migration to MongoDB Atlas.

## How to use

1. Place your `connections.json` file in this directory.
2. Run: `node migrate.js`
3. After migration, this folder can remain empty — all data is in MongoDB.

## File format

```json
{
  "connections": [
    {
      "id": "unique-uuid",
      "area": "Garalapadu",
      "vlanNo": "100",
      "customerName": "Customer Name",
      "landlineNo": "08643-123456",
      "userId": "12345_sid@ftth.bsnl.in",
      "notes": "",
      "status": "active",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```
