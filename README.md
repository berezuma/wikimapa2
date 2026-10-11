# Euskarazko Wikipediaren Mapa

Euskarazko Wikipediako artikulu geolokalizatuak mapa batean erakusten dituen web-orria. **https://wikimapa.berezuma.com**

- Maparen ikuspegiko artikuluak markatzaile gisa agertzen dira, multzokatuta. Bat sakatuta, laburpena eta irudia ikusten dira.
- Bista orokorra: zoom txikian, Euskal Herri osoko artikulu geolokalizatu guztiak (~14.000) ikusten dira.
- Bilatzailea: koordenaturik gabeko artikuluentzat (pertsonak, taldeak…), Wikidatako kokapen erlazionatu bat erakusten du (jaiotza-lekua, sorrera-lekua, kokapena edo udalerria).
- 24 kategoria-iragazki (museoak, gazteluak, ermitak, trikuharriak, mendiak, ibaiak, herriak…), Wikidatako datuekin. Zoom 12tik gora erabil daitezke.
- Zoom handian, artikuluen argazkiak markatzaile biribil gisa.
- **Zer falta da**: Wikipediaren beste hizkuntzetan artikulua duten baina euskaraz ez duten Euskal Herriko ~1.900 leku, "Itzuli euskarara" botoiarekin (Wikipediaren itzulpen-tresna). Iragazki-panelean aktibatzen da (edo `?falta=1`).
- Denbora-lerroa: lekuak sortu ziren hurrenkeran agertzen dira (K.a. 4000 – gaur), erreprodukzio automatikoarekin. Wikidatan sorrera-data duten lekuak bakarrik (~2.500).
- "Harritu nazazu" botoia: Euskal Herriko artikulu aleatorio batera hegan (iragazkiak kontuan hartuta).
- Zure kokapena, maparen edo artikulu baten esteka partekatzea (`?lat=…&lon=…&zoom=…&artikulua=…`) eta Euskal Herriko muga.

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

## Datuak eguneratu

`data/` karpetako fitxategiak Wikidatatik sortzen dira: kategorien azpiklaseak, eta bista orokorreko, iragazkietako eta denbora-lerroko artikuluak.

**Automatikoki eguneratzen dira astero** (astelehenetan, GitHub Actions: `.github/workflows/datuak.yml`). Lanak datuak sortzen ditu, egiaztatzen ditu (artikulu-kopurua ez da % 10 baino gehiago jaitsi behar, kategoria guztiek azpiklaseak izan behar dituzte…), eta aldaketarik badago, `main`-era igotzen ditu; webgunea berehala eguneratzen da. Egiaztapenak huts egiten badu, ez da ezer igotzen, eta GitHub-ek mezu elektronikoz abisatzen du. Eskuz ere exekuta daiteke: GitHub-en, *Actions → Datuak eguneratu → Run workflow*.

Kategoria bat gehitzean edo aldatzean (`index.html`-eko `data-category`), sortu datuak eskuz:

```
npm run build:data
npm run check:data
```

Bot-ak astero commit-ak egiten dituenez, egin `git pull` lanean hasi aurretik.

## Probak

```
npm test            # js/api.js-en unitate-probak (sarerik gabe)
npm run test:e2e    # nabigatzaileko probak Chrome headless-en (benetako APIak, sarea behar da)
```

## Egitura

| Fitxategia | Edukia |
|---|---|
| `index.html` | Orriaren egitura eta estilo propioak |
| `js/app.js` | Mapa, markatzaileak eta interfazea |
| `js/api.js` | Wikipedia eta Wikidata APIetarako deiak |
| `ehmuga.json` | Euskal Herriko muga (`[latitudea, longitudea]` puntuak) |
| `data/` | Sortutako datuak (`npm run build:data`) |
| `tools/build-data.mjs` | Datuak sortzeko script-a |
| `tests/` | Unitate-probak (`unit/`) eta nabigatzaileko probak (`e2e/`) |
| `css/tailwind.css` | Sortutako Tailwind CSS-a (`npm run build:css`) |

## Datuak

[Wikipedia](https://eu.wikipedia.org) eta [Wikidata](https://www.wikidata.org) (APIak, nabigatzailetik zuzenean), [OpenStreetMap](https://www.openstreetmap.org/copyright) mapa-teselak, [Leaflet](https://leafletjs.com) eta [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster).

## Egilea eta lizentzia

Beñat Erezumak egina. Orrian adierazitako lizentzia: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.eu).
