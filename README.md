# BSNL Connection Manager

మీ నాన్నగారి BSNL connection data ను locally store చేసి, add/edit చేయడానికి చేసిన website.

## మొదలుపెట్టడం

1. ఈ folder లో terminal తెరవండి.
2. మొదటిసారి మాత్రమే `npm install` చేయండి.
3. తర్వాత `npm start` చేయండి.
4. Browser లో `http://localhost:3000` తెరవండి.

## అందులో ఉన్నవి

- కొత్త BSNL customer / connection add చేయడం
- ఉన్న record edit లేదా delete చేయడం
- పేరు, మొబైల్ నంబర్, connection నంబర్ ద్వారా search చేయడం
- `.xlsx` లేదా `.csv` Excel file import చేయడం
- మొత్తం data ని Excel file గా export చేయడం
- Backup కోసం JSON download చేయడం

ప్రతి record కి village ఉంటుంది. ప్రస్తుతం Garalapadu, Pedavaripalem, మరియు Kommuru కోసం filter ఉంది.

> Area / Route ఎంచుకుని కొత్త Excel file replace చేస్తే, ఎంచుకున్న area records మాత్రమే తొలగి కొత్త file లోని records save అవుతాయి. మిగతా areas data మారదు.

## Excel columns

మీ Excel లో ఈ column names ఉంటే auto గా import అవుతుంది:

`VLAN NO`, `NAME`, `LANDLINE NO`, `USER ID`, `Status`, `Notes`

కనీసం **NAME** ఉండాలి. మిగిలినవి ఖాళీగా ఉన్నా తర్వాత website లో edit చేయవచ్చు.

## డేటా ఎక్కడ ఉంటుంది?

మీ records ఈ project లోని `data/connections.json` file లో save అవుతాయి. కాబట్టి ఆ folder ని backup గా copy చేసుకుంటే data safe గా ఉంటుంది. ఇది local website; ఈ computer లోనే తెరుచుకుంటుంది, public internet లో upload కాదు.
