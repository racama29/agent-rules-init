# Cómo interpretar la cobertura

La cobertura indica qué partes del código fueron ejecutadas por las pruebas. No mide
por sí sola si una prueba comprueba correctamente el comportamiento.

## Ramas

Una rama es una alternativa de control: los lados verdadero y falso de un `if`, cada
caso de un condicional ternario, las alternativas de `switch` y algunos cortocircuitos
con `&&`, `||` o `??`.

Una cobertura de ramas del 87,84% significa que las pruebas recorrieron aproximadamente
88 de cada 100 alternativas instrumentadas. El porcentaje restante suele corresponder
a errores poco frecuentes, combinaciones de opciones o fallbacks de plataforma que no
se ejecutaron durante la suite.

## Funciones

La cobertura de funciones cuenta funciones, métodos y callbacks que fueron invocados
al menos una vez. Una cobertura del 84,16% significa que aproximadamente 84 de cada 100
funciones instrumentadas fueron llamadas por alguna prueba.

Este dato puede ser menor que la cobertura de líneas cuando un archivo contiene muchos
callbacks pequeños o funciones de traducción: numerosas líneas pueden ejecutarse al
cargar el módulo sin que se invoquen todas esas funciones.

## Umbrales del proyecto

La CI exige como mínimo:

- 90% de líneas y sentencias;
- 85% de ramas;
- 82% de funciones.

Una regresión por debajo de cualquiera de esos valores hace fallar la suite. Además se
mantienen pruebas de corpus, seguridad, integración y rendimiento, porque una cobertura
alta no garantiza precisión ni calidad del contenido generado.
