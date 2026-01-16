# How to Add or Modify Categories

Categories for the Banner Tester and Mix-In Ad Tester are stored in a JSON file for easy management.

## File Location
- Runtime file: set `CATEGORIES_PATH` to an absolute path (recommended for servers).
- Default local file: `categories.json` in the project root.
- Template: `categories.template.json` (used to seed new files).

## Structure

```json
{
  "RegionName": {
    "Category Name": [
      { "label": "Display Name", "path": "/productstore/path" }
    ]
  }
}
```

## Example

```json
{
  "US & Canada": {
    "Supplements": [
      { "label": "Show All", "path": "/productstore/supplements" },
      { "label": "Vitality Pack", "path": "/productstore/supplements/vitality-pack" }
    ],
    "Personal Care": [
      { "label": "Show All", "path": "/productstore/personal-care" }
    ]
  },
  "Europe": {
    "Supplements": [
      { "label": "Show All", "path": "/productstore/supplements" }
    ]
  }
}
```

##  Adding a New Category

1. Open the categories file (from `CATEGORIES_PATH` or `categories.json`).
2. Find the region (e.g., "US & Canada")
3. Add a new category object:

```json
"New Category Name": [
  { "label": "Show All", "path": "/productstore/new-category" },
  { "label": "Subcategory 1", "path": "/productstore/new-category/sub1" }
]
```

4. Save the file
5. Restart the server (`npm start`)

## Adding a Subcategory

Add a new item to an existing category array:

```json
"Supplements": [
  { "label": "Show All", "path": "/productstore/supplements" },
  { "label": "New Subcategory", "path": "/productstore/supplements/new-sub" }
]
```

## Adding a New Region

```json
{
  "New Region": {
    "CategoryName": [
      { "label": "Show All", "path": "/productstore/category" }
    ]
  }
}
```

**Note:** After adding a new region, you'll also need to update the cultures and paths in `config.js` under the `banner.regions` section.

## Path Format

The `path` should match the actual URL path on the website:
- Production: `https://www.melaleuca.com/productstore/supplements`
- Stage: `https://productstore2-us-preview.melaleuca.com/productstore/supplements`

The path in categories.json should be: `/productstore/supplements`

## Troubleshooting

If categories don't appear after editing:
1. Check JSON syntax (use a JSON validator)
2. Ensure the file is saved
3. Restart the server
4. Check server console for errors about loading the categories file
