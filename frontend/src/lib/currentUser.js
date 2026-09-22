// Легкий облік "хто вніс запис" - без логіну/пароля. Ім'я людина вписує сама
// (як і "Назва господарства" на бланках), зберігається в цьому браузері.
const KEY = 'agro-zp:user-name';

export const getCurrentUserName = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

export const setCurrentUserName = (name) => {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // приватний режим тощо - просто не запам'ятається цього разу
  }
};
