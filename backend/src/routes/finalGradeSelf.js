'use strict';

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/auth');
const { getMyPublishedFinalGradesHandler } = require('../controllers/finalGradeController');

router.get('/me/final-grades', authMiddleware, getMyPublishedFinalGradesHandler);

module.exports = router;
