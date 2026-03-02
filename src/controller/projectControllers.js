import Project from "../modals/projects.js";
import User from "../modals/user.js";
import mongoose from "mongoose";
import QualityIssue from "../modals/qualityIssue.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import ContractorModel from "../modals/contractor.model.js";

export const getUserProjects = async (req, res) => {
  try {
    const { _id, role } = req.user;

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({ error: "Invalid user ID." });
    }

    let query = {};
    if (role === "site_incharge") {
      query.siteIncharge = _id;
    } else if (role === "contractor") {
      query.contractors = _id;
    } else if (
      ["accountant", "owner", "admin", "customer_purchased"].includes(role)
    ) {
      query = {};
    } else {
      return res.status(400).json({ error: "Unsupported role." });
    }

    const projects = await Project.find(query)
      .populate("projectId", "_id projectName location")
      .populate("floorUnit", "_id floorNumber unitType")
      .populate("unit", "_id propertyType plotNo")
      .populate("contractors", "_id name email")
      .populate("siteIncharge", "_id name email");

    return res.status(200).json(projects);
  } catch (error) {
    console.error("Error fetching project data:", error);
    return res
      .status(500)
      .json({ error: "Server error fetching project details." });
  }
};

export const createProject = async (req, res) => {
  try {
    const {
      projectId,
      clientName,
      floorUnit,
      unit,
      startDate,
      endDate,
      estimatedBudget,
      description,
      teamSize,
      siteIncharge,
      status,
    } = req.body;

    const existingProject = await Project.findOne({
      projectId,
      floorUnit,
      unit,
    });

    if (existingProject) {
      return res.status(400).json({
        message: "Project already exists for this Building + Floor + Unit",
      });
    }

    const newProject = new Project({
      projectId,
      clientName, // 🔥 explicitly saved
      floorUnit,
      unit,
      startDate,
      endDate,
      estimatedBudget,
      description,
      teamSize,
      siteIncharge,
      status,
      createdBy: req.user._id,
    });

    await newProject.save();

    res.status(201).json({
      message: "Project created successfully",
      project: newProject,
    });
  } catch (error) {
    console.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
};

export const getUserTasks = async (req, res) => {
  try {
    const { role, _id } = req.user;

    const allowedRoles = [
      "site_incharge",
      "contractor",
      "owner",
      "admin",
      "customer_purchased",
    ];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const priorityOrder = { high: 3, medium: 2, low: 1, unspecified: 0 };

    const query =
      role === "site_incharge"
        ? { siteIncharge: _id }
        : role === "contractor"
          ? { contractors: _id }
          : {};

    const projects = await Project.find(query)
      .populate("projectId", "_id projectName")
      .populate("floorUnit", "_id floorNumber unitType")
      .populate("unit", "_id propertyType plotNo")
      .populate("contractors", "_id name")
      .populate("siteIncharge", "_id name")
      .lean();

    const taskList = [];

    for (const project of projects) {
      const projectName = project.projectId?.projectName || "Unnamed Project";
      const floorNumber = project.floorUnit?.floorNumber || "N/A";
      const unitType = project.floorUnit?.unitType || "N/A";
      const plotNo = project.unit?.plotNo || "N/A";
      const siteInchargeName = project.siteIncharge?.name || "N/A";

      const contractorMap = Object.fromEntries(
        (project.contractors || []).map((c) => [c._id.toString(), c.name]),
      );

      const unitsMap = project.units || {};

      for (const [unitName, tasks] of Object.entries(unitsMap)) {
        for (const task of tasks) {
          const taskContractorId = task.contractor?.toString();
          const commonTaskData = {
            taskTitle: task.title || "Untitled Task",
            projectName,
            floorNumber,
            unitType,
            plotNo,
            unit: unitName,
            deadline: task.deadline,
            priority: task.priority || "unspecified",
            constructionPhase: task.constructionPhase,
            contractorUploadedPhotos: task.contractorUploadedPhotos || [],
            projectId: project._id,
            contractorId: task.contractor,
            siteInchargeName,
            _id: task._id,
          };

          if (role === "site_incharge") {
            if (
              task.isApprovedByContractor &&
              task.statusForContractor === "completed"
            ) {
              taskList.push({
                ...commonTaskData,
                contractorName:
                  contractorMap[taskContractorId] || "Unknown Contractor",
                status: task.statusForSiteIncharge || "pending verification",
                submittedByContractorOn: task.submittedByContractorOn || null,
                submittedBySiteInchargeOn:
                  task.submittedBySiteInchargeOn || null,

                verificationDecision: task.verificationDecision || "",
                qualityAssessment: task.qualityAssessment || "",
                noteBySiteIncharge: task.noteBySiteIncharge || "",
                siteInchargeUploadedPhotos:
                  task.siteInchargeUploadedPhotos || [],
              });
            }
          } else if (
            role === "contractor" &&
            taskContractorId === _id.toString()
          ) {
            taskList.push({
              ...commonTaskData,
              status: task.statusForContractor || "in_progress",
              progress: task.progressPercentage,

              verificationDecision: task.verificationDecision || "",
              qualityAssessment: task.qualityAssessment || "",
              noteBySiteIncharge: task.noteBySiteIncharge || "",
              siteInchargeUploadedPhotos: task.siteInchargeUploadedPhotos || [],
            });
          } else if (["owner", "admin", "customer_purchased"].includes(role)) {
            taskList.push({
              ...commonTaskData,
              status: task.statusForContractor || "in_progress",
              progress: task.progressPercentage,
              contractorName:
                contractorMap[taskContractorId] || "Unknown Contractor",

              verificationDecision: task.verificationDecision || "",
              qualityAssessment: task.qualityAssessment || "",
              noteBySiteIncharge: task.noteBySiteIncharge || "",
              siteInchargeUploadedPhotos: task.siteInchargeUploadedPhotos || [],
            });
          }
        }
      }
    }

    taskList.sort((a, b) => {
      const aPriority = priorityOrder[a.priority?.toLowerCase()] || 0;
      const bPriority = priorityOrder[b.priority?.toLowerCase()] || 0;
      return bPriority - aPriority;
    });

    res.status(200).json(taskList);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Server error fetching tasks" });
  }
};

export const updateProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const updateData = { ...req.body, updatedBy: req.user._id };

  if (!projectId) {
    throw new ApiError(400, "Project ID is required");
  }

  if (!updateData || Object.keys(updateData).length === 0) {
    throw new ApiError(400, "No update data provided");
  }

  const updatedProject = await Project.findByIdAndUpdate(
    projectId,
    { $set: updateData },
    { new: true, runValidators: true },
  );

  if (!updatedProject) {
    throw new ApiError(404, "Project not found");
  }

  // 🔔 Notify Owner + Admin when project is completed (ADDED)
  if (updateData.status === "Completed") {
    const receivers = await User.find({
      role: { $in: ["owner", "admin"] },
    }).select("_id");

    await Promise.all(
      receivers.map((user) =>
        createNotification({
          userId: user._id,
          title: "Project Completed",
          message: `Project ${
            updatedProject.name || updatedProject._id
          } has been marked as Completed.`,
          triggeredBy: req.user._id,
        })
      )
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedProject, "Project updated successfully"));
});

export const deleteProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID");
  }

  const project = await Project.findById(projectId);

  if (!project) {
    throw new ApiError(404, "Project not found");
  }

  project.deletedBy = req.user._id;
  await project.deleteOne();

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Project deleted successfully"));
});

export const getContractorsForSiteIncharge = async (req, res) => {
  try {
    const { role, _id: siteInchargeId } = req.user;

    if (role !== "site_incharge" && role !== "accountant") {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    const contractors = await Project.aggregate([
      {
        $match: {
          siteIncharge: new mongoose.Types.ObjectId(siteInchargeId),
        },
      },

      // Populate references
      {
        $lookup: {
          from: "buildings",
          localField: "projectId",
          foreignField: "_id",
          as: "projectId",
        },
      },
      { $unwind: { path: "$projectId", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "floorunits",
          localField: "floorUnit",
          foreignField: "_id",
          as: "floorUnit",
        },
      },
      { $unwind: { path: "$floorUnit", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "propertyunits",
          localField: "unit",
          foreignField: "_id",
          as: "unit",
        },
      },
      { $unwind: { path: "$unit", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "users",
          localField: "contractors",
          foreignField: "_id",
          as: "contractors",
        },
      },

      { $unwind: "$contractors" },

      // Convert Map to array safely
      {
        $project: {
          projectName: "$projectId.projectName",
          floorNumber: "$floorUnit.floorNumber",
          unitType: "$unit.plotNo",
          contractor: "$contractors",
          unitsArray: {
            $ifNull: [{ $objectToArray: "$units" }, []],
          },
        },
      },

      { $unwind: { path: "$unitsArray", preserveNullAndEmptyArrays: true } },

      { $unwind: { path: "$unitsArray.v", preserveNullAndEmptyArrays: true } },

      // Only count tasks belonging to this contractor
      {
        $addFields: {
          isMyTask: {
            $cond: [
              {
                $eq: ["$unitsArray.v.contractor", "$contractor._id"],
              },
              1,
              0,
            ],
          },
        },
      },

      {
        $group: {
          _id: "$contractor._id",
          name: { $first: "$contractor.name" },
          email: { $first: "$contractor.email" },
          phone: { $first: "$contractor.phone" },
          company: { $first: "$contractor.company" },
          specialization: { $first: "$contractor.specialization" },
          status: { $first: "$contractor.status" },

          totalTasks: {
            $sum: {
              $cond: [{ $eq: ["$isMyTask", 1] }, 1, 0],
            },
          },

          completedTasks: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isMyTask", 1] },
                    {
                      $or: [
                        {
                          $eq: [
                            "$unitsArray.v.statusForSiteIncharge",
                            "approved",
                          ],
                        },
                        {
                          $gte: ["$unitsArray.v.progressPercentage", 100],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },

          projects: {
            $addToSet: {
              projectName: "$projectName",
              floorNumber: "$floorNumber",
              unitType: "$unitType",
            },
          },
        },
      },

      {
        $addFields: {
          completionRate: {
            $cond: [
              { $gt: ["$totalTasks", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ["$completedTasks", "$totalTasks"] },
                      100,
                    ],
                  },
                  1,
                ],
              },
              0,
            ],
          },
        },
      },

      { $sort: { totalTasks: -1 } },
    ]);

    res.status(200).json(contractors);
  } catch (error) {
    console.error("Error fetching contractors:", error);
    res.status(500).json({ error: "Server error fetching contractors" });
  }
};

export const updateTask = async (req, res) => {
  try {
    res.status(200).json({ res: req.body });
  } catch (err) {
    res.send(err);
  }
};

export const getContractorTasksUnderSiteIncharge = async (req, res) => {
  try {
    const siteInchargeId = req.user._id;
    const contractorId = req.params.contractorId;

    if (
      !mongoose.Types.ObjectId.isValid(siteInchargeId) ||
      !mongoose.Types.ObjectId.isValid(contractorId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid Site Incharge or Contractor ID" });
    }

    // Find all projects assigned to both this site incharge and the contractor
    const projects = await Project.find({
      siteIncharge: siteInchargeId,
      contractors: contractorId,
    })
      .populate("projectId", "_id projectName")
      .populate("floorUnit", "_id floorNumber unitType")
      .populate("unit", "_id propertyType plotNo")
      .populate("contractors", "_id name email phone company specialization")
      .lean();

    const contractorTasks = [];

    for (const project of projects) {
      const projectName = project.projectId?.projectName || "Unnamed Project";
      const floorNumber = project.floorUnit?.floorNumber;
      const unitType = project.floorUnit?.unitType;
      const units = project.units || {};
      const contractorStats = {
        totalTasks: 0,
        completedTasks: 0,
      };

      // Loop through units and gather tasks
      for (const [unitName, taskArray] of Object.entries(units)) {
        for (const task of taskArray) {
          if (task.contractor?.toString() === contractorId) {
            // Correct completion check
            const isCompleted =
              task.progressPercentage >= 100 ||
              task.statusForSiteIncharge === "approved" ||
              task.isApprovedBySiteManager === true;

            contractorStats.totalTasks++;

            if (isCompleted) {
              contractorStats.completedTasks++;
            }

            contractorTasks.push({
              _id: task._id,
              taskTitle: task.title || "Untitled Task",
              description: task.description || "",
              projectId: project._id,
              projectName,
              floorNumber,
              unitType,
              unit: unitName,
              unitId: project.unit?._id,
              plotNo: project.unit?.plotNo,
              propertyType: project.unit?.propertyType,
              constructionPhase: task.constructionPhase,
              status: isCompleted ? "completed" : task.statusForSiteIncharge,
              priority: task.priority || "unspecified",
              progressPercentage: task.progressPercentage || 0,
              deadline: task.deadline,
              submittedByContractorOn: task.submittedByContractorOn || null,
              submittedBySiteInchargeOn: task.submittedBySiteInchargeOn || null,
              contractorUploadedPhotos: task.contractorUploadedPhotos || [],
            });
          }
        }
      }
    }

    // Sort tasks by priority (high → low → medium → low → unspecified)
    const priorityOrder = { high: 3, medium: 2, low: 1, unspecified: 0 };
    contractorTasks.sort((a, b) => {
      const aPriority =
        priorityOrder[(a.priority || "unspecified").toLowerCase()] || 0;
      const bPriority =
        priorityOrder[(b.priority || "unspecified").toLowerCase()] || 0;
      return bPriority - aPriority;
    });

    res.status(200).json({ tasks: contractorTasks });
  } catch (error) {
    console.error(
      "Error fetching contractor tasks under site incharge:",
      error,
    );
    res
      .status(500)
      .json({ message: "Server error fetching contractor tasks", error });
  }
};

export const updateTaskByIdForContractor = async (req, res) => {
  try {
    const { taskId, projectId } = req.params;
    const newTask = req.body;
    const { shouldSubmit } = req.body;
    const { role } = req.user;

    if (
      !mongoose.Types.ObjectId.isValid(taskId) ||
      !mongoose.Types.ObjectId.isValid(projectId)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ID format" });
    }

    const project = await Project.findById(projectId);

    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    let taskFound = false;

    for (const [unitName, taskArray] of project.units.entries()) {
      const task = taskArray.find((t) => t._id.toString() === taskId);

      if (task) {
        // 🔥 1️⃣ REMOVE PHOTOS
        if (
          Array.isArray(newTask.removePhotos) &&
          newTask.removePhotos.length > 0
        ) {
          task.contractorUploadedPhotos = task.contractorUploadedPhotos.filter(
            (photo) => !newTask.removePhotos.includes(photo),
          );
        }

        // 🔥 2️⃣ ADD NEW PHOTOS (THIS WAS MISSING)
        if (Array.isArray(newTask.photos) && newTask.photos.length > 0) {
          task.contractorUploadedPhotos.push(...newTask.photos);
        }

        // 🔥 3️⃣ Update other fields
        if (newTask.evidenceTitleByContractor)
          task.evidenceTitleByContractor = newTask.evidenceTitleByContractor;

        if (newTask.status) {
          if (role === "site_incharge")
            task.statusForSiteIncharge = newTask.status;
          else if (role === "contractor")
            task.statusForContractor = newTask.status;
        }

        if (typeof newTask.progressPercentage === "number")
          task.progressPercentage = newTask.progressPercentage;

        if (newTask.constructionPhase)
          task.constructionPhase = newTask.constructionPhase;

        if (shouldSubmit) {
          task.submittedByContractorOn = new Date();
          task.isApprovedByContractor = true;
        }

        taskFound = true;
        break;
      }
    }

    if (!taskFound) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found in any unit" });
    }

    project.markModified("units");
    project.updatedBy = req.user._id;
    await project.save();

    // 🔔 Notify Site Incharge when contractor submits task (ADDED)
    if (shouldSubmit && project.siteIncharge) {
      await createNotification({
        userId: project.siteIncharge,
        title: "Task Submitted",
        message: `A contractor has submitted progress for a construction task.`,
        triggeredBy: req.user._id,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error updating task:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const miniUpdateTaskByIdForContractor = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const { phase, progress, status } = req.body;

    if (
      !mongoose.Types.ObjectId.isValid(projectId) ||
      !mongoose.Types.ObjectId.isValid(taskId)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid project or task ID" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    let taskFound = false;

    for (const [unitName, tasks] of project.units.entries()) {
      const task = tasks.find((t) => t._id.toString() === taskId);
      if (task) {
        if (phase) task.constructionPhase = phase;
        if (typeof progress === "number") task.progressPercentage = progress;
        if (status) task.statusForContractor = status;
        if (progress === 100 || status === "completed") {
          task.isApprovedByContractor = true;
        }

        taskFound = true;
        break;
      }
    }

    if (!taskFound) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found in project" });
    }
    project.markModified("units");
    project.updatedBy = req.user._id;
    await project.save();

    return res.status(200).json({
      success: true,
      message: "Task updated successfully",
    });
  } catch (err) {
    console.error("Contractor task update failed:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const updateTaskByIdForSiteIncharge = async (req, res) => {
  try {
    const { projectId, taskId } = req.params;
    const {
      noteBySiteIncharge,
      qualityAssessment,
      verificationDecision,
      siteInchargeUploadedPhotos,
    } = req.body;
    if (
      !mongoose.Types.ObjectId.isValid(projectId) ||
      !mongoose.Types.ObjectId.isValid(taskId)
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid project or task ID" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    let taskUpdated = false;

    for (const [unitName, taskArray] of project.units.entries()) {
      const task = taskArray.find((t) => t._id.toString() === taskId);
      if (task) {
        // Append site incharge photos
        if (Array.isArray(siteInchargeUploadedPhotos)) {
          task.siteInchargeUploadedPhotos.push(...siteInchargeUploadedPhotos);
        }

        if (noteBySiteIncharge) task.noteBySiteIncharge = noteBySiteIncharge;
        if (qualityAssessment) task.qualityAssessment = qualityAssessment;
        if (verificationDecision) {
          task.verificationDecision = verificationDecision;
          task.statusForSiteIncharge = verificationDecision;
        }

        // If verification status is approved
        if (verificationDecision?.toLowerCase() === "approved") {
          task.isApprovedBySiteManager = true;
        }

        task.submittedBySiteInchargeOn = new Date();

        taskUpdated = true;
        break;
      }
    }

    if (!taskUpdated) {
      return res
        .status(404)
        .json({ success: false, message: "Task not found in any unit" });
    }
    project.markModified("units");
    project.updatedBy = req.user._id;
    await project.save();
    return res.status(200).json({
      success: true,
      message: "Task updated successfully by Site Incharge",
    });
  } catch (err) {
    console.error("Error updating task by site incharge:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const addContractorForSiteIncharge = async (req, res) => {
  try {
    const { contractor, project, taskTitle, deadline, priority } = req.body;

    if (!contractor || !project || !taskTitle || !deadline) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const projectDoc = await Project.findById(project)
      .populate("floorUnit", "_id floorNumber unitType")
      .populate("unit", "_id unitName");

    if (!projectDoc) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    const unitId = projectDoc.unit._id.toString();

    // Add contractor if not already
    if (!projectDoc.contractors.some((id) => id.toString() === contractor)) {
      projectDoc.contractors.push(contractor);
    }

    const newTask = {
      contractor,
      title: taskTitle,
      statusForContractor: "in_progress",
      statusForSiteIncharge: "pending verification",
      deadline: new Date(deadline),
      progressPercentage: 0,
      priority: priority || "medium",
    };

    if (!projectDoc.units.has(unitId)) {
      projectDoc.units.set(unitId, []);
    }

    projectDoc.units.get(unitId).push(newTask);

    projectDoc.markModified("units");
    projectDoc.updatedBy = req.user._id;
    await projectDoc.save();

    return res.status(201).json({
      message: "Contractor assigned successfully",
      task: newTask,
    });
  } catch (err) {
    console.error("Assign contractor error:", err);
    return res.status(500).json({
      message: "Server Error",
      error: err.message,
    });
  }
};

export const assignTaskToContractor = async (req, res) => {
  try {
    const {
      title,
      contractorId,
      projectId,
      priority,
      deadline,
      phase,
      qualityIssueId,
      description,
    } = req.body;

    // 1️⃣ Validate required fields
    if (
      !title ||
      !contractorId ||
      !projectId ||
      !deadline ||
      !phase ||
      !qualityIssueId
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // 2️⃣ Validate ObjectIds
    if (
      !mongoose.Types.ObjectId.isValid(contractorId) ||
      !mongoose.Types.ObjectId.isValid(projectId) ||
      !mongoose.Types.ObjectId.isValid(qualityIssueId)
    ) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    // 3️⃣ Validate contractor
    const contractor = await User.findById(contractorId);
    if (!contractor) {
      return res.status(404).json({ message: "Contractor not found" });
    }

    // 4️⃣ Validate project
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // 5️⃣ Ensure project has unit
    const unitKey = project.unit?.toString();
    if (!unitKey) {
      return res.status(400).json({ message: "Project unit not found" });
    }

    // 6️⃣ Ensure contractors array exists
    if (!Array.isArray(project.contractors)) {
      project.contractors = [];
    }

    // Safe ObjectId comparison
    const contractorExists = project.contractors.some(
      (id) => id.toString() === contractor._id.toString(),
    );

    if (!contractorExists) {
      project.contractors.push(contractor._id);
    }

    // 7️⃣ Ensure units map exists
    if (!project.units) {
      project.units = new Map();
    }

    if (!project.units.has(unitKey)) {
      project.units.set(unitKey, []);
    }

    const tasks = project.units.get(unitKey) || [];

    // 8️⃣ Create new task
    const newTask = {
      contractor: contractor._id,
      title,
      priority: priority || "medium",
      deadline: new Date(deadline),
      constructionPhase: phase,
      description: description || "",
      statusForContractor: "in_progress",
      statusForSiteIncharge: "pending verification",
      progressPercentage: 0,
    };

    tasks.push(newTask);
    project.units.set(unitKey, tasks);
    project.markModified("units");
    project.updatedBy = req.user._id;
    await project.save();

    // 9️⃣ Update Quality Issue safely
    const issue = await QualityIssue.findById(qualityIssueId);
    if (!issue) {
      return res.status(404).json({ message: "Quality issue not found" });
    }

    issue.contractor = contractor._id;
    issue.updatedBy = req.user._id;
    await issue.save();

    // 🔔 Notify Contractor (ADDED)
    await createNotification({
      userId: contractor._id,
      title: "New Construction Task Assigned",
      message: `You have been assigned a new task: ${title}.`,
      triggeredBy: req.user._id,
    });

    return res.status(200).json({
      message: "Task assigned successfully",
    });
  } catch (error) {
    console.error("Assignment error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const createTaskForProjectUnit = async (req, res) => {
  try {
    const { title, description, projectId, phase, priority, deadline } =
      req.body;

    if (!title || !description || !projectId || !phase || !deadline) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    const newTask = {
      title,
      description,
      contractor: req.user?._id, // assuming auth middleware injects user
      deadline: new Date(deadline),
      constructionPhase: phase,
      priority,
    };
    const unit = project?.unit;

    if (!project.units) {
      project.units = new Map();
    }
    // Initialize unit if not present
    if (!project.units.has(unit)) {
      project.units.set(unit, []);
    }

    const taskArray = project.units.get(unit);
    taskArray.push(newTask);

    project.units.set(unit, taskArray);
    project.markModified("units");
    project.updatedBy = req.user._id;
    await project.save();

    return res
      .status(201)
      .json({ success: true, message: "Task created successfully" });
  } catch (error) {
    console.error("Error creating task:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const assignContractorToUnit = async (req, res) => {
  try {
    const { projectId, unit, contractorId } = req.body;

    if (!projectId || !unit || !contractorId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Validate ObjectId
    if (
      !mongoose.Types.ObjectId.isValid(projectId) ||
      !mongoose.Types.ObjectId.isValid(contractorId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid projectId or contractorId" });
    }

    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // 1. Add to contractors array if not already present
    if (!project.contractors.some((id) => id.toString() === contractorId)) {
      project.contractors.push(contractorId);
    }
    if (!project.assignedContractors) {
      project.assignedContractors = new Map();
    }
    // 2. Add contractor to assignedContractors map for the unit
    const currentAssigned = project.assignedContractors.get(unit) || [];

    if (!currentAssigned.includes(contractorId)) {
      currentAssigned.push(contractorId);
      project.assignedContractors.set(unit, currentAssigned);
    }

    project.updatedBy = req.user._id;
    await project.save();

    res
      .status(200)
      .json({ message: "Contractor assigned successfully", project });
  } catch (error) {
    console.error("Error assigning contractor:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const projectDropDownData = asyncHandler(async (req, res) => {
  const projects = await Project.find({})
    .select("_id projectId floorUnit unit")
    .populate("projectId", "_id projectName")
    .populate("floorUnit", "_id floorNumber unitType")
    .populate("unit", "_id plotNo propertyType");

  let message;
  if (!projects || projects.length === 0) {
    message = "No projects found";
  } else {
    message = "Projects fetched successfully";
  }

  res.status(200).json(new ApiResponse(201, projects, message));
});

export const projectDropDownDataForSiteIncharge = asyncHandler(
  async (req, res) => {
    const { role, _id: siteInchargeId } = req.user;

    if (role !== "site_incharge" && role !== "accountant") {
      return res.status(403).json(new ApiResponse(403, null, "Access denied"));
    }

    const projects = await Project.find({
      siteIncharge: siteInchargeId,
    })
      .select("_id projectId floorUnit unit")
      .populate("projectId", "_id projectName")
      .populate("floorUnit", "_id floorNumber unitType")
      .populate("unit", "_id plotNo propertyType");

    let message;
    if (!projects || projects.length === 0) {
      message = "No projects found";
    } else {
      message = "Projects fetched successfully";
    }

    res.status(200).json(new ApiResponse(200, projects, message));
  },
);

export const getAllContractors = asyncHandler(async (req, res) => {
  const contractors = await User.find({
    role: "contractor",
  }).select("_id name");

  const message =
    contractors.length === 0
      ? "No contractors found"
      : "Contractors fetched successfully";

  res.status(200).json(new ApiResponse(200, contractors, message));
});

export const getCompletedTasksForUnit = asyncHandler(async (req, res) => {
  const { projectId, unit } = req.params;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID");
  }

  const project = await Project.findOne({ _id: projectId })
    .populate("contractors", "_id name email")
    .populate("siteIncharge", "_id name email")
    .lean();

  if (!project) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], "No project found for this projectId"));
  }

  const tasksInUnit =
    project.units instanceof Map
      ? project.units.get(unit)
      : project.units?.[unit] || [];

  const completedTasks = tasksInUnit
    .filter(
      (task) =>
        task.statusForContractor === "completed" &&
        task.isApprovedBySiteManager === true,
    )
    .map((task) => ({
      _id: task._id,
      title: task.title,
      constructionPhase: task.constructionPhase,
      progressPercentage: task.progressPercentage,
      submittedOn: task.submittedByContractorOn,
      deadline: task.deadline,
      contractor:
        project.contractors?.find(
          (c) => c._id.toString() === task.contractor?.toString(),
        ) || null,
      contractorUploadedPhotos: task.contractorUploadedPhotos || [],
      siteInchargeUploadedPhotos: task.siteInchargeUploadedPhotos || [],
    }));

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        projectDetails: {
          _id: project._id,
          building: project.projectId || null,
          siteIncharge: project.siteIncharge || null,
          floorUnit: project.floorUnit || null,
          unit: project.unit || null,
          contractors: project.contractors || [],
        },
        completedTasks,
      },
      completedTasks.length > 0
        ? "Completed tasks fetched successfully"
        : "No completed tasks found for this unit",
    ),
  );
});

export const getUnitProgressByBuilding = asyncHandler(async (req, res) => {
  const { buildingId, floorUnitId, unitId } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(buildingId) ||
    !mongoose.Types.ObjectId.isValid(floorUnitId) ||
    !mongoose.Types.ObjectId.isValid(unitId)
  ) {
    throw new ApiError(400, "Invalid buildingId, floorUnitId, or unitId");
  }

  const project = await Project.findOne({
    projectId: buildingId,
    floorUnit: floorUnitId,
    unit: unitId,
  });

  if (!project) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          buildingId,
          floorUnitId,
          unitId,
          totalTasks: 0,
          overallProgress: 0,
        },
        "No project found for this unit",
      ),
    );
  }

  let tasksInUnit = [];

  if (project.units instanceof Map) {
    tasksInUnit = project.units.get(unitId) || [];
  } else if (
    project.units &&
    typeof project.units === "object" &&
    !Array.isArray(project.units)
  ) {
    tasksInUnit = project.units[unitId] || [];
  }

  if (!tasksInUnit || tasksInUnit.length === 0) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          buildingId,
          floorUnitId,
          unitId,
          totalTasks: 0,
          overallProgress: 0,
        },
        "No tasks found for this unit",
      ),
    );
  }

  const totalProgress = tasksInUnit.reduce(
    (sum, task) => sum + (task?.progressPercentage || 0),
    0,
  );

  const averageProgress = Math.round(totalProgress / tasksInUnit.length);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        buildingId,
        floorUnitId,
        unitId,
        totalTasks: tasksInUnit.length,
        overallProgress: averageProgress,
      },
      "Unit progress calculated successfully",
    ),
  );
});
