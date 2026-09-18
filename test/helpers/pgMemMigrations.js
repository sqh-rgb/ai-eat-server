const UNSUPPORTED_RLS = /^[ \t]*ALTER[ \t]+TABLE[ \t]+(?:public\.)?(?:app_admins|user_upload_intents)[ \t]+ENABLE[ \t]+ROW[ \t]+LEVEL[ \t]+SECURITY[ \t]*;[ \t]*(?:\r?\n|$)/gim;

function stripPgMemUnsupportedRls(sql) {
  return sql.replace(UNSUPPORTED_RLS, '');
}

module.exports = { stripPgMemUnsupportedRls };
