import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './ui.jsx';

const OPTIONS = [
  { value: 1, label: 'Петров' },
  { value: 2, label: 'Петровченко' },
  { value: 3, label: 'Сергієнко Сергій Сергійович' },
];

describe('SearchableSelect', () => {
  it('показує placeholder, коли нічого не вибрано', () => {
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => {}} placeholder="Виберіть працівника" />);
    expect(screen.getByPlaceholderText('Виберіть працівника')).toBeInTheDocument();
  });

  it('показує підпис обраного варіанту, коли є value', () => {
    render(<SearchableSelect options={OPTIONS} value={1} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Петров')).toBeInTheDocument();
  });

  it('фільтрує список за будь-якою частиною назви (не лише з початку)', async () => {
    const user = userEvent.setup();
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => {}} />);

    await user.click(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'сер');

    expect(screen.getByText('Сергієнко Сергій Сергійович')).toBeInTheDocument();
    expect(screen.queryByText('Петров')).not.toBeInTheDocument();
    expect(screen.queryByText('Петровченко')).not.toBeInTheDocument();
  });

  it('клік по варіанту викликає onChange з обраним значенням', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value="" onChange={onChange} />);

    await user.click(screen.getByRole('textbox'));
    await user.click(screen.getByText('Петровченко'));

    expect(onChange).toHaveBeenCalledWith({ target: { name: undefined, value: '2' } });
  });

  it('кнопка "×" очищує вибір', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value={1} onChange={onChange} />);

    await user.click(screen.getByLabelText('Очистити вибір'));

    expect(onChange).toHaveBeenCalledWith({ target: { name: undefined, value: '' } });
  });

  it('показує "Нічого не знайдено", якщо запит нічого не дав', async () => {
    const user = userEvent.setup();
    render(<SearchableSelect options={OPTIONS} value="" onChange={() => {}} />);

    await user.click(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'zzzzz');

    expect(screen.getByText('Нічого не знайдено')).toBeInTheDocument();
  });
});
