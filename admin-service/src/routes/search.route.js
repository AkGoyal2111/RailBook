const express = require('express');
const { searchTrains, autocomplete } = require('../controllers/search.controller');

const router = express.Router();

// Public search endpoints (no auth) — fronted by the API gateway.
router.get('/trains', searchTrains);
router.get('/autocomplete', autocomplete);

module.exports = router;
