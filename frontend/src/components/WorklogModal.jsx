import { Modal } from './ui.jsx';
import { WorklogForm } from './WorklogForm.jsx';

/**
 * Форма шляхового листа як модальне вікно — для виклику з Журналу робіт і
 * Даних з техніки, щоб не втрачати фільтр/прокрутку тієї сторінки переходом
 * на окрему /worklogs. Монтує WorklogForm лише поки відкрито (key на
 * initialForm?.id змушує React створити свіжий екземпляр форми щоразу, коли
 * відкривається новий запис/чернетка, а не перевикористовувати попередній стан).
 */
export function WorklogModal({ open, initialForm, source, hecterraHintHa, hecterraFieldHint, onClose, onSaved }) {
  return (
    <Modal
      open={open}
      size="xl"
      onClose={onClose}
      title={initialForm?.id ? `Редагування шляхового #${initialForm.id}` : 'Реєстрація роботи'}
    >
      {open && (
        <WorklogForm
          key={initialForm?.id ?? 'new'}
          initialForm={initialForm}
          source={source}
          hecterraHintHa={hecterraHintHa}
          hecterraFieldHint={hecterraFieldHint}
          continuous={false}
          onCancel={onClose}
          onSaved={(saved) => {
            onClose();
            onSaved?.(saved);
          }}
        />
      )}
    </Modal>
  );
}
