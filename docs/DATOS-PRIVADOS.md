# Datos privados y separación de Git

Inventario Terreno separa estrictamente **software** y **datos operacionales**.

## Regla principal

GitHub contiene:

- código fuente;
- interfaz;
- scripts;
- pruebas sintéticas;
- documentación.

GitHub **no** debe contener:

- planillas reales;
- bases SQLite;
- fotografías;
- respaldos;
- exportaciones;
- certificados y claves;
- tokens;
- archivos `.env`;
- datos administrativos reales.

## Rutas privadas

```text
imports/      planillas maestras locales
data/         base SQLite operacional
backups/      copias SQLite
 evidence/    fotografías y evidencia de incidencias
exports/      informes/exportaciones con datos reales
local-certs/  certificado y clave HTTPS locales
```

La ruta real es `evidence/` sin espacio inicial; la indentación anterior sólo representa una lista conceptual.

## Fuente maestra XLSX

La instalación de referencia utiliza:

```text
imports/ACTIVOS.xlsx
```

El archivo se trata como **fuente de sólo lectura**. El importador calcula SHA-256 antes y después de leerlo y rechaza la operación si cambia durante la lectura.

Nunca use el XLSX como archivo de salida ni lo modifique desde Inventario Terreno.

## SQLite

La base operacional predeterminada es:

```text
data/inventario.sqlite
```

No debe editarse manualmente durante la operación. Las sesiones cerradas forman parte de la trazabilidad histórica.

## Evidencia fotográfica

Las fotografías se almacenan localmente en:

```text
evidence/
```

La base guarda metadatos y referencias relativas. Un respaldo que incluya sólo SQLite **no conserva por sí solo las fotografías**.

Para traslado completo se debe conservar conjuntamente:

```text
data/inventario.sqlite
+
evidence/
```

Consulte [RESPALDO-RESTAURACION.md](RESPALDO-RESTAURACION.md).

## Certificados

`local-certs/` es configuración local del equipo. No mezcle certificados con los respaldos de inventario ni los publique.

La clave privada de una CA de `mkcert` no debe transferirse a otro usuario por Git.

## Verificar exclusión

Antes de cualquier commit:

```powershell
git check-ignore -v imports/
git check-ignore -v data/
git check-ignore -v backups/
git check-ignore -v evidence/
git check-ignore -v exports/
git check-ignore -v local-certs/
```

También revise:

```powershell
git status --short
```

Si aparece un archivo real de inventario como `A`, `M` o `??`, no lo agregue al commit hasta determinar por qué no está protegido.

## Datos para pruebas

Todos los tests deben usar información completamente sintética.

No copie:

- códigos reales;
- nombres reales de funcionarios;
- ubicaciones sensibles;
- fotografías reales;
- seriales reales;
- fragmentos de la planilla maestra.

## Traslado entre equipos

Código:

```text
GitHub
```

Datos:

```text
canal autorizado separado
```

Antes y después de transferir un archivo importante, calcule SHA-256:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'RUTA\archivo'
```

Una diferencia de hash significa que el archivo recibido no es idéntico al original.
