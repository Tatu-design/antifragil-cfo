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
│   ├── bank_sl/        Extracto de la cuenta de la SL             (.xlsx / .csv)
│   ├── bank_sc/        Extracto de la cuenta de la SC             (.xlsx / .csv)
│   ├── cash_account/   Cuenta de cash Antifrágil                  (.xlsx)
│   ├── clinic_bank/    Ventas de clínica cobradas por datáfono    (.xlsx)
│   ├── clinic_cash/    Ventas de clínica cobradas en efectivo     (.xlsx)
│   ├── documents/      Documentos justificativos (PDF o índice)
│   └── manual_close/   Cierre manual previo, solo para comparar
│
├── outputs/<YYYY-MM>/  Informes y ledger.json generados por el motor
├── backups/            Copias de documentos originales
└── logs/
```

## Notas

- **La carpeta determina el tipo y la cuenta.** Un extracto en `bank_sl/` es de la SL: explícito y sin ambigüedad.
- Los Google Sheets se descargan como `.xlsx` mientras no exista la integración con Drive.
- Si un libro tiene pestañas mensuales, no hace falta recortarlo: el motor usa la del periodo.
- Los archivos temporales de Office (`~$...`) se ignoran automáticamente.

## Uso

```bash
npm run cfo -- inspect 2026-09    # mirar sin tocar
npm run cfo -- analyze 2026-09    # motor completo + informes
npm run cfo -- compare 2026-08    # contrastar con el cierre manual
```
