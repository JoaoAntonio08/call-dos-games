// Relógio de 20 ms sem acumular atraso: se o Node atrasar um tique, os seguintes compensam.

export function every20ms(tick) {
  const start = performance.now();
  let n = 0;
  let timer = null;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    const due = Math.floor((performance.now() - start) / 20);
    // no máximo 5 quadros de uma vez (se o PC travou muito, não despeja áudio velho)
    let k = 0;
    while (n <= due && k < 5) {
      n++;
      k++;
      try {
        tick();
      } catch (e) {
        console.error("relógio:", e);
      }
    }
    if (n <= due) n = due + 1;
    timer = setTimeout(step, Math.max(1, start + n * 20 - performance.now()));
  };
  step();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
