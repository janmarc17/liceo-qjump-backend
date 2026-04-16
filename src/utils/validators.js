function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidStudentId(studentId) {
  return /^2022\d{7}$/.test(String(studentId || '').trim());
}

function isValidBirthDate(birthdate) {
  const normalized = String(birthdate || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return normalized <= new Date().toISOString().slice(0, 10);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = {
  normalizeEmail,
  isValidStudentId,
  isValidBirthDate,
  generateOtp
};
