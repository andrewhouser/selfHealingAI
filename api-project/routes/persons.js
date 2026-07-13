const express = require('express');
const router = express.Router();
const { findAll, findById } = require('../../database-project/db');

/**
 * GET /persons
 * Returns all Person_Record entities as a JSON array.
 * Person_Record fields: name, email, address, phone_number
 */
router.get('/', async (req, res) => {
  try {
    const persons = await findAll();
    res.json(persons);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve persons' });
  }
});

/**
 * GET /persons/:id
 * Returns a single Person_Record by _id, or 404 if not found.
 * Person_Record fields: name, email, address, phone_number
 */
router.get('/:id', async (req, res) => {
  try {
    const person = await findById(req.params.id);
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }
    res.json(person);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve person' });
  }
});

module.exports = router;