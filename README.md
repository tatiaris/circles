# Friends Graph

A small, dependency-free browser app for editing a friends list and exploring connections between people.

## Run locally

Open `index.html` in a modern browser. No package installation or build step is required.

## Use the app

- **Graph:** import a JSON file by dropping it onto the graph view or using **Import**. Pan by dragging, zoom with the mouse wheel or zoom controls, and use **Fit** to frame the graph.
- **Visualizations:** choose Network, Clusters, Adjacency matrix, Focus, or Arc diagram from the View menu. Focus mode lets you choose or click a person.
- **Edit friends:** add people, connect mutuals, and have changes update the graph automatically. The list is saved in the current browser.
- **Export:** download the edited list as `friends-summary.json`, or export the graph as an image.

## JSON format

Import either a top-level array of friends or an object containing a `friends` array. Each friend needs a unique username and a non-empty `full_name` or `name`. Mutuals can be usernames or objects containing an `id`/`pk` and/or `username`.

```json
{
  "friends": [
    {
      "id": "123",
      "full_name": "Alex Example",
      "username": "alex.example",
      "mutuals": [
        { "id": "456", "username": "jordan.example" }
      ]
    },
    {
      "id": "456",
      "full_name": "Jordan Example",
      "username": "jordan.example",
      "mutuals": []
    }
  ]
}
```

Mutual connections are displayed when the mutual person is also present in the imported friends list. IDs and usernames should be unique.

## Project files

- `index.html` — application markup
- `app.js` — graph data, visualizations, canvas interactions, and JSON import
- `styles.css` — graph and shared interface styles
- `friends-builder.js` — friends list editor, persistence, and export
- `friends-builder.css` — editor styles
