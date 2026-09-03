# local-data — zona de datos reales

⛔ **El contenido de esta carpeta NUNCA se sube a GitHub.**

Solo se versionan este README y los `.gitkeep`. Todo lo demás está excluido por
`.gitignore`: extractos, facturas, Excels, informes generados, copias y logs.

Se puede mover a otra ubicación (por ejemplo, una carpeta sincronizada con Drive)
con la variable `ANTIFRAGIL_CFO_DATA_DIR` en `.env.local`.

---

## Estructura

```text
local-data/
├── inputs/<YYYY-MM>/
│   ├── bank/           Extracto bancario del mes             (.xlsx / .csv)
│   ├── expenses/       Facturas de gastos                    (.pdf y/o índice .xlsx/.csv)
│   ├── income/         Documentos justificativos de ingresos
│   ├── clinic_bank/    Ventas de clínica cobradas por banco/datáfono  (.xlsx)
│   ├── clinic_cash/    Ventas de clínica cobradas en efectivo         (.xlsx)
│   ├── cash_account/   Cuenta de cash Antifrágil                      (.xlsx)
│   └── master/         Cash Flow GEA 2026 (referencia histórica)      (.xlsx)
│
├── outputs/<YYYY-MM>/  Informes generados por el motor
├── backups/            Copias de documentos originales antes de cualquier escritura
└── logs/
```

## Notas

- **La carpeta determina el tipo de documento.** Es más fiable que el nombre del archivo.
- Los Google Sheets se descargan como `.xlsx` mientras no exista la integración con Drive.
- Si un libro tiene pestañas mensuales, no hace falta recortarlo: el motor usa la del periodo.
- Los archivos temporales de Office (`~$...`) se ignoran automáticamente.

## Uso

```bash
npm run cfo -- inspect 2026-08    # mirar sin tocar
npm run cfo -- analyze 2026-08    # motor completo + informes
```
