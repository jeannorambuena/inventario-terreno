# Formato de datos de entrada

Inventario Terreno puede crear una base nueva a partir de una planilla XLSX compatible.

La implementación de referencia lee por defecto la hoja:

```text
BD_SQL
```

## Columnas requeridas

El importador actual exige encabezados equivalentes a:

```text
codigo_bien
bien
marca
serie
modelo
color
direccion
departamento
seccion
finbaja
codigo_escaner
```

Los encabezados se normalizan: se quitan espacios extremos, tildes y signos, se convierten a minúsculas y los separadores pasan a `_`.

Ejemplo sintético:

| codigo_bien | bien | marca | serie | modelo | color | direccion | departamento | seccion | finbaja | codigo_escaner |
|---|---|---|---|---|---|---|---|---|---|---|
| 01-02-00001 | Monitor | Marca A | SN-DEMO-001 | Modelo X | Negro | Dirección A | Departamento 1 | Oficina 101 | | 0010200001 |
| 01-02-00002 | Silla | Marca B | | Modelo Y | Azul | Dirección A | Departamento 1 | Oficina 101 | | 0010200002 |

No utilice datos reales en archivos de ejemplo versionados.

## Códigos como texto

Los códigos patrimoniales deben tratarse como texto.

Esto evita perder ceros iniciales.

Correcto:

```text
0010200001
```

Incorrecto si Excel lo transforma numéricamente:

```text
10200001
```

El importador intenta preservar formatos numéricos compuestos sólo por ceros, pero la práctica más segura es mantener los códigos como texto desde la fuente.

## Jerarquía de ubicación

La aplicación utiliza:

```text
Dirección → Departamento → Sección
```

La combinación de esos tres campos identifica la ubicación administrativa de trabajo.

No confunda esa ubicación maestra con el **punto físico observado** registrado posteriormente durante una incidencia de terreno.

## Campos vacíos

Los campos descriptivos pueden estar vacíos cuando la fuente original no dispone del dato, pero `codigo_bien` es esencial para crear el activo.

Las filas completamente vacías son ignoradas.

## Duplicados

El lector identifica códigos duplicados y genera advertencias. La aplicación de terreno dispone además de resolución explícita cuando un código puede corresponder a varios candidatos.

No elimine duplicados automáticamente de la planilla sólo para satisfacer el importador; primero determine si reflejan una situación real que requiere conciliación.

## Importación

Para una instalación NUEVA:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1 `
  -Mode NUEVO `
  -ImportExcelPath 'D:\RUTA-AUTORIZADA\ACTIVOS.xlsx' `
  -ConfirmDataOperation
```

El proceso:

1. copia la fuente a `imports/ACTIVOS.xlsx`;
2. comprueba que no exista una base previa;
3. calcula SHA-256;
4. lee el XLSX;
5. importa ubicaciones y activos a SQLite;
6. crea un respaldo inicial.

La fuente XLSX no se modifica.

## Adaptación para otra organización

Otra organización puede reutilizar Inventario Terreno si prepara una planilla que mantenga la semántica de estas columnas.

No es necesario usar nombres reales de unidades en el código fuente. La estructura Dirección/Departamento/Sección se obtiene de los datos importados.

Si una organización necesita un modelo jerárquico distinto, debe adaptar conscientemente el importador y sus pruebas antes de utilizar datos reales.
