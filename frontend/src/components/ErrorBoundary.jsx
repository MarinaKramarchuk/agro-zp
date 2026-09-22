import { Component } from 'react';

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Необроблена помилка:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="card max-w-md p-6 text-center">
            <div className="text-lg font-semibold text-slate-800">Щось пішло не так</div>
            <p className="mt-2 text-sm text-slate-500">
              Сталася непередбачена помилка. Спробуйте перезавантажити сторінку — якщо не допоможе,
              повідомте про проблему.
            </p>
            <button type="button" className="btn-primary mt-4" onClick={() => window.location.reload()}>
              Перезавантажити
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
