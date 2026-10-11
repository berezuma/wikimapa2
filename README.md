# Euskarazko Wikipediaren Mapa

Euskarazko Wikipediako artikulu geolokalizatuak mapa batean erakusten dituen web-orria.

- Maparen ikuspegiko artikuluak markatzaile gisa agertzen dira; bat sakatuta, laburpena eta irudia ikusten dira.
- Bilatzailea: koordenaturik gabeko artikuluentzat (pertsonak, taldeak…), Wikidatako kokapen erlazionatu bat erakusten du (jaiotza-lekua, sorrera-lekua, kokapena edo udalerria).
- Kategoria-iragazkiak (museoak, gazteluak, mendiak, hondartzak…), Wikidatako datuekin. Zoom 12tik gora erabil daitezke.
- Zure kokapena, maparen esteka partekatzea (`?lat=…&lon=…&zoom=…`) eta Euskal Herriko muga.

## Exekutatu lokalean

Orriak ES moduluak eta `ehmuga.json` kargatzen ditu, beraz HTTP zerbitzari batetik zerbitzatu behar da (`file://`-tik ez dabil):

```
python3 -m http.server 8000
```

Ondoren ireki <http://localhost:8000/>.

## Estiloak (Tailwind)

`css/tailwind.css` sortutako fitxategia da, eta repoan gordetzen da: argitaratzeko ez da build-urratsik behar. Tailwind klase bat gehitu edo aldatzen baduzu `index.html`-en edo `js/`-n, sortu berriz:

```
npm install
npm run build:css
```

## Egitura

| Fitxategia | Edukia |
|---|---|
| `index.html` | Orriaren egitura eta estilo propioak |
| `js/app.js` | Mapa, markatzaileak eta interfazea |
| `js/api.js` | Wikipedia eta Wikidata APIetarako deiak |
| `ehmuga.json` | Euskal Herriko muga (`[latitudea, longitudea]` puntuak) |
| `css/tailwind.css` | Sortutako Tailwind CSS-a (`npm run build:css`) |

## Datuak

[Wikipedia](https://eu.wikipedia.org) eta [Wikidata](https://www.wikidata.org) (APIak, nabigatzailetik zuzenean), [OpenStreetMap](https://www.openstreetmap.org/copyright) mapa-teselak eta [Leaflet](https://leafletjs.com).

## Egilea eta lizentzia

Beñat Erezumak egina. Orrian adierazitako lizentzia: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.eu).
