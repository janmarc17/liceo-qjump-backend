const { normalizeEmail, isValidStudentId, isValidBirthDate, generateOtp } = require('../src/utils/validators');

describe('validators', () => {
  test('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  ExAmPle@GMail.COM  ')).toBe('example@gmail.com');
  });

  test('isValidStudentId matches pattern', () => {
    expect(isValidStudentId('20220000001')).toBe(true);
    expect(isValidStudentId('20210000001')).toBe(false);
    expect(isValidStudentId('abcd')).toBe(false);
  });

  test('isValidBirthDate validates format and no future dates', () => {
    expect(isValidBirthDate('2000-01-01')).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect(isValidBirthDate(today)).toBe(true);
    expect(isValidBirthDate('2999-01-01')).toBe(false);
    expect(isValidBirthDate('invalid')).toBe(false);
  });

  test('generateOtp returns 6-digit string', () => {
    const otp = generateOtp();
    expect(typeof otp).toBe('string');
    expect(otp).toMatch(/^\d{6}$/);
  });
});
