"use client";

import { Component, type ReactNode } from "react";

/*
 * Rede de proteção das telas. Sem ela, um erro ao desenhar qualquer tela (ex.: ao abrir outro servidor)
 * desmontava o app inteiro, VoiceProvider junto, e a call caía. Aqui o erro fica preso no pedaço que quebrou:
 * a call continua e, ao navegar para outra tela (resetKey muda), ele tenta desenhar de novo.
 */
type Props = { children: ReactNode; resetKey?: string; compact?: boolean };
type State = { failed: boolean; key?: string };

export class ScreenGuard extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { failed: false, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown) {
    console.error("[tela] erro ao desenhar:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.compact) return null;
    return (
      <div className="grid flex-1 place-items-center bg-cocoa-3 p-6 text-center">
        <div>
          <p className="font-semibold text-oat">Esta tela tropeçou.</p>
          <p className="mt-1 text-[13.5px] text-oat/55">Sua call continua. Troque de canal ou tente de novo.</p>
          <button type="button" onClick={() => this.setState({ failed: false })} className="press mt-4 rounded-[9px] bg-cocoa-4 px-4 py-2 text-[13.5px] font-semibold text-oat">
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
}
