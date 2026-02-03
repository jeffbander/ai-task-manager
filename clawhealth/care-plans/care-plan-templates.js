#!/usr/bin/env node

/**
 * ClawHealth Care Plan Templates
 * 
 * Evidence-based care plan templates for common conditions
 * Following clinical guidelines for consistent, high-quality care
 */

const carePlans = {
  
  heartFailure: {
    name: "Heart Failure Management",
    description: "Comprehensive care plan for heart failure patients",
    guidelineSource: "2022 AHA/ACC/HFSA Heart Failure Guidelines",
    icd10Codes: ["I50.9", "I50.1", "I50.20", "I50.30"],
    
    assessmentCriteria: {
      nyhaClass: ["I", "II", "III", "IV"],
      ejectionFraction: ["HFrEF (<40%)", "HFmrEF (40-49%)", "HFpEF (≥50%)"],
      triggers: ["Volume overload", "Medication adherence", "Diet compliance", "Weight monitoring"]
    },
    
    goals: [
      "Reduce symptoms and improve quality of life",
      "Prevent disease progression and hospitalizations", 
      "Optimize medication therapy and adherence",
      "Maintain optimal fluid balance",
      "Improve functional capacity",
      "Patient education and self-management"
    ],
    
    interventions: [
      {
        category: "Medication Management",
        actions: [
          "ACE inhibitor or ARB optimization",
          "Beta-blocker titration to target dose", 
          "Diuretic management for volume status",
          "Mineralocorticoid receptor antagonist as appropriate",
          "SGLT2 inhibitor consideration (HFrEF)",
          "Daily medication adherence monitoring"
        ]
      },
      {
        category: "Monitoring",
        actions: [
          "Daily weight monitoring (report gains >2-3 lbs)",
          "Blood pressure and heart rate tracking",
          "Symptom assessment (SOB, edema, fatigue)",
          "Laboratory monitoring (BUN, creatinine, electrolytes)",
          "Functional status evaluation"
        ]
      },
      {
        category: "Lifestyle Modifications", 
        actions: [
          "Sodium restriction (≤2g daily)",
          "Fluid restriction if indicated (≤2L daily)",
          "Regular low-intensity exercise as tolerated",
          "Weight management if overweight",
          "Smoking cessation support",
          "Alcohol limitation or avoidance"
        ]
      },
      {
        category: "Patient Education",
        actions: [
          "Heart failure pathophysiology education",
          "Medication purpose and side effects",
          "Warning signs requiring immediate attention",
          "Dietary guidance and meal planning",
          "Exercise recommendations",
          "When to contact healthcare provider"
        ]
      }
    ],
    
    alertCriteria: {
      urgent: [
        "Weight gain >3 lbs in 24 hours or >5 lbs in week",
        "Severe shortness of breath or chest pain",
        "Missed ACE inhibitor/ARB for >24 hours",
        "Symptoms of hyperkalemia (>5.5 mEq/L)",
        "Systolic BP <90 or >180 mmHg"
      ],
      warning: [
        "Weight gain >2 lbs in 24 hours",
        "Increased swelling or shortness of breath",
        "Missed medication dose",
        "Dietary sodium indiscretion",
        "Dizziness or lightheadedness"
      ]
    },
    
    reminderSchedule: {
      daily: ["Weight measurement", "Medication adherence", "Symptom check"],
      weekly: ["Weight trend review", "Functional assessment"],
      monthly: ["Laboratory review", "Medication optimization", "Goal assessment"]
    }
  },

  diabetes: {
    name: "Type 2 Diabetes Management", 
    description: "Comprehensive diabetes care and glucose management",
    guidelineSource: "2023 ADA Standards of Medical Care in Diabetes",
    icd10Codes: ["E11.9", "E11.00", "E11.65"],
    
    goals: [
      "Achieve target HbA1c <7% (individualized)",
      "Maintain optimal blood pressure (<130/80)",
      "Manage cardiovascular risk factors",
      "Prevent diabetic complications",
      "Optimize medication therapy and adherence",
      "Promote healthy lifestyle behaviors"
    ],
    
    interventions: [
      {
        category: "Glucose Management",
        actions: [
          "Metformin optimization (first-line therapy)",
          "Second-line agent selection based on CV/renal benefits",
          "Insulin therapy if indicated",
          "Regular blood glucose monitoring",
          "HbA1c monitoring every 3-6 months",
          "Hypoglycemia prevention and management"
        ]
      },
      {
        category: "Cardiovascular Protection",
        actions: [
          "ACE inhibitor or ARB for nephropathy prevention", 
          "Statin therapy for lipid management",
          "Aspirin therapy for CV prevention (if appropriate)",
          "Blood pressure monitoring and management",
          "Regular cardiovascular risk assessment"
        ]
      },
      {
        category: "Lifestyle Interventions",
        actions: [
          "Medical nutrition therapy and carb counting",
          "Regular physical activity (150 min/week moderate)",
          "Weight management if overweight",
          "Smoking cessation counseling",
          "Alcohol moderation guidance"
        ]
      },
      {
        category: "Preventive Care",
        actions: [
          "Annual comprehensive foot exam",
          "Annual eye exam with ophthalmologist",
          "Nephropathy screening (ACR, eGFR)",
          "Immunization updates (flu, pneumonia, COVID)",
          "Dental care coordination"
        ]
      }
    ],
    
    alertCriteria: {
      urgent: [
        "Blood glucose >400 mg/dL or <70 mg/dL", 
        "Symptoms of DKA (nausea, vomiting, abdominal pain)",
        "Severe hypoglycemia with loss of consciousness",
        "Acute foot ulcer or infection",
        "New vision changes or eye symptoms"
      ],
      warning: [
        "Blood glucose consistently >250 mg/dL",
        "Missed insulin doses", 
        "Signs of infection (fever, wounds)",
        "Blood pressure >140/90 repeatedly",
        "Unexplained weight loss or fatigue"
      ]
    }
  },

  hypertension: {
    name: "Hypertension Management",
    description: "Blood pressure optimization and cardiovascular risk reduction", 
    guidelineSource: "2017 ACC/AHA High Blood Pressure Guidelines",
    icd10Codes: ["I10", "I15.9"],
    
    goals: [
      "Achieve target blood pressure <130/80 mmHg",
      "Reduce cardiovascular and stroke risk",
      "Optimize antihypertensive therapy",
      "Promote lifestyle modifications",
      "Monitor for target organ damage",
      "Improve medication adherence"
    ],
    
    interventions: [
      {
        category: "Medication Therapy",
        actions: [
          "First-line: ACE inhibitor, ARB, thiazide diuretic, or CCB",
          "Combination therapy for BP >20/10 above target",
          "Medication adherence monitoring and education",
          "Regular medication review and optimization",
          "Monitor for side effects and drug interactions"
        ]
      },
      {
        category: "Blood Pressure Monitoring",
        actions: [
          "Home BP monitoring with validated device",
          "Proper BP measurement technique education",
          "Regular clinic BP checks",
          "Target BP review and adjustment",
          "White coat and masked hypertension assessment"
        ]
      },
      {
        category: "Lifestyle Modifications",
        actions: [
          "DASH diet education and implementation",
          "Sodium reduction to <2.3g daily (ideal <1.5g)",
          "Regular aerobic exercise (≥30 min, 5-7 days/week)",
          "Weight management (BMI <25 kg/m²)",
          "Alcohol moderation (≤2 drinks/day men, ≤1 women)",
          "Smoking cessation support",
          "Stress management techniques"
        ]
      }
    ],
    
    alertCriteria: {
      urgent: [
        "Systolic BP >180 or diastolic >120 mmHg",
        "Signs of hypertensive emergency (headache, vision changes)",
        "Acute chest pain with elevated BP",
        "Severe medication side effects",
        "Signs of stroke or TIA"
      ],
      warning: [
        "BP consistently above target despite therapy",
        "Missed antihypertensive medication doses",
        "New or worsening headaches",
        "Dizziness or lightheadedness",
        "Medication adherence concerns"
      ]
    }
  },

  copd: {
    name: "COPD Management",
    description: "Chronic obstructive pulmonary disease care and exacerbation prevention",
    guidelineSource: "2023 GOLD COPD Guidelines", 
    icd10Codes: ["J44.0", "J44.1", "J44.9"],
    
    goals: [
      "Optimize bronchodilator therapy",
      "Prevent and treat exacerbations", 
      "Improve exercise tolerance and quality of life",
      "Smoking cessation (if applicable)",
      "Pulmonary rehabilitation participation",
      "Vaccination and infection prevention"
    ],
    
    interventions: [
      {
        category: "Bronchodilator Therapy",
        actions: [
          "Long-acting bronchodilator optimization (LABA/LAMA)",
          "Inhaled corticosteroid if indicated (eosinophils >300)",
          "Rescue bronchodilator availability (SABA)",
          "Proper inhaler technique education and verification",
          "Medication adherence monitoring"
        ]
      },
      {
        category: "Exacerbation Prevention",
        actions: [
          "Annual influenza vaccination",
          "Pneumococcal vaccination series",
          "COVID-19 vaccination",
          "Early recognition of exacerbation symptoms",
          "Action plan for symptom worsening",
          "Antibiotic/steroid prescription for severe exacerbations"
        ]
      },
      {
        category: "Lifestyle and Rehabilitation",
        actions: [
          "Smoking cessation counseling and support",
          "Pulmonary rehabilitation referral",
          "Regular exercise as tolerated",
          "Nutritional assessment and support",
          "Oxygen therapy if hypoxemic",
          "Environmental trigger avoidance"
        ]
      }
    ]
  }
};

// Generate personalized care plan
function generateCarePlan(condition, patientData, customizations = {}) {
  const template = carePlans[condition];
  if (!template) {
    throw new Error(`Care plan template not found for condition: ${condition}`);
  }

  const carePlan = {
    patientId: patientData.id,
    patientName: `${patientData.firstName} ${patientData.lastName}`,
    condition: template.name,
    guidelineSource: template.guidelineSource,
    createdDate: new Date().toISOString().split('T')[0],
    createdBy: patientData.physicianName || "Dr. Jeffrey Bander",
    
    goals: template.goals.map(goal => ({
      description: goal,
      target: customizations.goals?.[goal] || "To be determined",
      status: "active",
      progress: 0
    })),
    
    interventions: template.interventions.map(intervention => ({
      category: intervention.category,
      actions: intervention.actions.map(action => ({
        description: action,
        frequency: customizations.frequency?.[action] || "as indicated",
        status: "pending",
        lastCompleted: null
      }))
    })),
    
    monitoringCriteria: {
      alertCriteria: template.alertCriteria,
      reminderSchedule: template.reminderSchedule
    },
    
    nextReviewDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
    status: "active"
  };

  return carePlan;
}

// Validate care plan completeness
function validateCarePlan(carePlan) {
  const issues = [];
  
  if (!carePlan.goals || carePlan.goals.length === 0) {
    issues.push("Care plan must have at least one goal");
  }
  
  if (!carePlan.interventions || carePlan.interventions.length === 0) {
    issues.push("Care plan must have interventions");
  }
  
  // Check for medication-related interventions
  const hasMedicationComponent = carePlan.interventions.some(intervention => 
    intervention.category.toLowerCase().includes('medication')
  );
  
  if (!hasMedicationComponent) {
    issues.push("Consider adding medication management component");
  }
  
  return {
    isValid: issues.length === 0,
    issues: issues
  };
}

// Export templates and functions
export { carePlans, generateCarePlan, validateCarePlan };

// CLI usage
if (process.argv[2] === 'demo') {
  const demoPatient = {
    id: 'demo_001',
    firstName: 'Sarah',
    lastName: 'Johnson',
    physicianName: 'Dr. Jeffrey Bander'
  };
  
  const heartFailurePlan = generateCarePlan('heartFailure', demoPatient, {
    goals: {
      "Reduce symptoms and improve quality of life": "NYHA Class II or better",
      "Optimize medication therapy and adherence": ">95% adherence rate"
    }
  });
  
  console.log('📋 Sample Heart Failure Care Plan:');
  console.log(JSON.stringify(heartFailurePlan, null, 2));
  
  const validation = validateCarePlan(heartFailurePlan);
  console.log('\n✅ Validation Result:', validation);
}