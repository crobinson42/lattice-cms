---
'@latticecms/admin': patch
---

After a delete, the list never shows the deleted document. The delete empties the collection's cached lists and counts before the list mounts, so the list fetches fresh instead of showing its last page for one fetch. Other writes still refresh what is on screen in place.
