'use strict';

const mongoose = require('mongoose');
const Deliverable = require('../models/Deliverable');
const ContributionRecord = require('../models/ContributionRecord');
const { FinalGradeCalculationService } = require('./finalGradeCalculationService');

class FinalGradePreviewService {
  constructor() {
    this.calculator = new FinalGradeCalculationService();
  }

  /**
   * Generates a preview of the final grades for a given group
   * @param {string} groupId 
   */
  async previewGroupGrade(groupId) {
    if (!groupId) {
      const error = new Error('groupId is required');
      error.status = 400;
      throw error;
    }

    // 1. Fetch D4 (Deliverables) and join D5 (Evaluations) & D8 (SprintConfig)
    // using a single Aggregation Pipeline to prevent N+1 query problem.
    const deliverables = await Deliverable.aggregate([
      { 
        $match: { 
          groupId, 
          status: { $in: ['accepted', 'evaluated', 'under_review'] } 
        } 
      },
      {
        $lookup: {
          from: 'evaluations', // D5
          localField: 'deliverableId',
          foreignField: 'deliverableId',
          as: 'evaluations'
        }
      },
      {
        $lookup: {
          from: 'sprint_configs', // D8
          let: { type: '$deliverableType', sprint: '$sprintId' },
          pipeline: [
            { 
              $match: { 
                $expr: { 
                  $and: [ 
                    { $eq: ['$deliverableType', '$$type'] }, 
                    { $eq: ['$sprintId', '$$sprint'] } 
                  ] 
                } 
              } 
            }
          ],
          as: 'config'
        }
      },
      { $unwind: { path: '$config', preserveNullAndEmptyArrays: true } }
    ]);

    if (!deliverables || deliverables.length === 0) {
      return { baseGroupScore: 0, students: [] };
    }

    let totalWeightedScore = 0;
    let totalWeight = 0;
    const rubricWeights = { deliverables: {} };

    // 2. Validate completeness and compute average score per deliverable
    for (const item of deliverables) {
      const weight = item.config?.weight != null ? item.config.weight : 1.0;
      rubricWeights.deliverables[item.deliverableId] = weight;

      if (!item.evaluations || item.evaluations.length === 0) {
        const error = new Error(`Missing Evaluation Data: Zorunlu deliverable (${item.deliverableId}) henüz puanlanmamış.`);
        error.status = 400;
        throw error;
      }

      // Check partial evaluations (if 2 out of 3 graded, etc.) and NULL vs 0.
      const hasPending = item.evaluations.some(ev => ev.status === 'pending' || ev.score == null);
      if (hasPending) {
        const error = new Error(`Incomplete Evaluations: Deliverable (${item.deliverableId}) jüri değerlendirmeleri tamamlanmamış (Kısmi değerlendirme).`);
        error.status = 409;
        throw error;
      }

      // Compute simple average among the evaluators for this deliverable
      const sum = item.evaluations.reduce((acc, ev) => acc + ev.score, 0);
      const avgScore = sum / item.evaluations.length;

      // Process 6.0 External Signal: Late Submission Penalty
      let finalDeliverableScore = avgScore;
      if (item.config?.deadline && new Date(item.submittedAt) > new Date(item.config.deadline)) {
        // e.g., apply a 10% penalty
        finalDeliverableScore = finalDeliverableScore * 0.9;
      }

      totalWeightedScore += (finalDeliverableScore * weight);
      totalWeight += weight;
    }

    // 3. Compute baseGroupScore
    const baseGroupScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) : 0;

    // 4. Fetch D6 (ContributionRecords) to get Student Ratios
    const contributions = await ContributionRecord.find({ groupId });
    const studentMap = {};
    
    for (const c of contributions) {
      if (!studentMap[c.studentId]) {
        studentMap[c.studentId] = { studentId: c.studentId, ratioSum: 0, count: 0 };
      }
      studentMap[c.studentId].ratioSum += (c.contributionRatio != null ? c.contributionRatio : 1.0);
      studentMap[c.studentId].count += 1;
    }

    const ratios = Object.values(studentMap).map(s => ({
      studentId: s.studentId,
      contributionRatio: s.ratioSum / s.count
    }));

    // 5. Delegate to Pure Calculation Engine
    return this.calculator.computeFinalGrades(baseGroupScore, ratios, rubricWeights);
  }
}

module.exports = new FinalGradePreviewService();
