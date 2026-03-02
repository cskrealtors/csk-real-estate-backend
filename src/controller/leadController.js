import Lead from "../modals/leadModal.js";
import Property from "../modals/propertyModel.js";
import Commission from "../modals/commissionsModal.js";
import TeamManagement from "../modals/teamManagementModal.js";
import User from "../modals/user.js";
import TeamLeads from "../modals/TeamLeadmanagement.js";
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { createNotification } from "../utils/notificationHelper.js";

export const saveLead = asyncHandler(async (req, res) => {
  const leadData = req.body;
  leadData.addedBy = req.user._id;
  leadData.createdBy = req.user._id;
  leadData.isPropertyLead = true;

  const newLead = new Lead(leadData);
  const savedLead = await newLead.save();

  // 🔔 Notify Sales Managers about new lead
  const managers = await User.find({ role: "sales_manager" });
  for (const manager of managers) {
    await createNotification({
      userId: manager._id,
      title: "New Lead Added",
      message: `A new lead for ${savedLead.name} has been added by ${req.user.name}.`,
      triggeredBy: req.user._id,
    });
  }

  res
    .status(201)
    .json(new ApiResponse(201, savedLead, "Lead saved successfully"));
});

export const createOpenPlotLead = asyncHandler(async (req, res) => {
  const { openPlot, name, email, phone, source, notes, innerPlot } = req.body;

  if (!openPlot || !innerPlot) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Open plot is required"));
  }

  const lead = await Lead.create({
    name,
    email,
    phone,
    source,
    notes,

    // plot relation
    openPlot,
    innerPlot,

    // reset others
    property: null,
    floorUnit: null,
    unit: null,
    openLand: null,

    // flags
    isPlotLead: true,
    isLandLead: false,
    isPropertyLead: false,

    addedBy: req.user._id,
    createdBy: req.user._id,
  });

  res
    .status(201)
    .json(new ApiResponse(201, lead, "Open plot lead created successfully"));
});

export const createOpenLandLead = asyncHandler(async (req, res) => {
  const { openLand, name, email, phone, source, notes } = req.body;

  if (!openLand) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Open land is required"));
  }

  const lead = await Lead.create({
    name,
    email,
    phone,
    source,
    notes,

    // land relation
    openLand,

    // reset others
    property: null,
    floorUnit: null,
    unit: null,
    openPlot: null,
    innerPlot: null,

    // flags
    isLandLead: true,
    isPlotLead: false,
    isPropertyLead: false,

    addedBy: req.user._id,
    createdBy: req.user._id,
  });

  res
    .status(201)
    .json(new ApiResponse(201, lead, "Open land lead created successfully"));
});

export const getAllLeads = async (req, res) => {
  try {
    const { role, _id } = req.user;

    let query = {};

    // ADMIN & SALES MANAGER → see all
    if (role === "admin" || role === "owner") {
      query = {};
    }

    // ================= SALES MANAGER =================
    else if (role === "sales_manager") {
      // 1️⃣ Get Team Leads under this Sales Manager
      const teamLeads = await TeamLeads.find({
        salesId: _id,
        isDeleted: false,
      }).select("teamLeadId");

      const teamLeadIds = teamLeads.map((t) => t.teamLeadId);

      // 2️⃣ Get Agents under those Team Leads
      const agents = await TeamManagement.find({
        teamLeadId: { $in: teamLeadIds },
        isDeleted: false,
      }).select("agentId");

      const agentIds = agents.map((a) => a.agentId);

      // 3️⃣ Build query
      query = {
        $or: [
          { addedBy: _id }, // sales own leads
          { addedBy: { $in: teamLeadIds } }, // team lead leads
          { addedBy: { $in: agentIds } }, // agent leads
        ],
      };
    }

    // ================= TEAM LEAD =================
    else if (role === "team_lead") {
      const teamAgents = await TeamManagement.find({
        teamLeadId: _id,
        isDeleted: false,
      }).select("agentId");

      const agentIds = teamAgents.map((t) => t.agentId);

      query = {
        $or: [
          { addedBy: _id }, // own leads
          { addedBy: { $in: agentIds } }, // agents
        ],
      };
    }

    // ================= AGENT =================
    else if (role === "agent") {
      query = { addedBy: _id };
    }

    const leads = await Lead.find({ ...query, isDeleted: false })
      .populate("property", "projectName location propertyType")
      .populate("floorUnit", "floorNumber unitType")
      .populate("unit", "plotNo propertyType")
      .populate("openPlot", "projectName plotNo memNo")
      .populate("openLand", "projectName location landType")
      .populate("addedBy", "name email role");

    res.status(200).json({
      message: "Leads fetched successfully",
      leads,
    });
  } catch (error) {
    console.error("Error fetching leads:", error.message);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

export const buildLeadAccessQuery = async (user) => {
  const { role, _id } = user;

  if (role === "admin" || role === "sales_manager") {
    return {};
  }

  if (role === "agent") {
    return { addedBy: _id };
  }

  if (role === "team_lead") {
    const teamAgents = await TeamManagement.find({
      teamLeadId: _id,
      isDeleted: false,
    }).select("agentId");
    const agentIds = teamAgents.map((t) => t.agentId);

    return {
      $or: [{ addedBy: _id }, { addedBy: { $in: agentIds } }],
    };
  }

  return { addedBy: _id };
};

export const getLeadsByUserId = async (req, res) => {
  try {
    const userId = req.user._id;

    const leads = await Lead.find({ addedBy: userId, isDeleted: false })
      .populate("property", "projectName location propertyType")
      .populate("floorUnit", "floorNumber unitType")
      .populate("unit", "plotNo propertyType")
      .populate("openPlot", "projectName openPlotNo")
      .populate("innerPlot", "plotNo")
      .populate("openLand", "projectName location landType")
      .populate("addedBy");
    res.status(200).json(leads);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching leads for logged-in user",
      error: error.message,
    });
  }
};

export const updateLeadById = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, _id } = req.user;

    const lead = await Lead.findOne({ _id: id, isDeleted: false });
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    // RBAC
    if (
      role !== "admin" &&
      role !== "sales_manager" &&
      lead.addedBy.toString() !== _id.toString()
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const {
      name,
      email,
      phone,
      source,
      status,
      propertyStatus,
      notes,
      property,
      floorUnit,
      unit,
      openPlot,
      innerPlot,
      openLand,
    } = req.body;

    const update = {
      name,
      email,
      phone,
      source,
      status,
      propertyStatus,
      notes,
      lastContact: new Date(),
      updatedBy: req.user._id,
    };

    /* ---------------- Lead-type enforcement ---------------- */

    // PROPERTY LEAD
    if (lead.isPropertyLead) {
      update.property = property;
      update.floorUnit = floorUnit;
      update.unit = unit;

      update.openPlot = null;
      update.innerPlot = null;
      update.openLand = null;
    }

    // PLOT LEAD
    if (lead.isPlotLead) {
      update.openPlot = openPlot;
      update.innerPlot = innerPlot;

      update.property = null;
      update.floorUnit = null;
      update.unit = null;
      update.openLand = null;
    }

    // LAND LEAD
    if (lead.isLandLead) {
      update.openLand = openLand;

      update.property = null;
      update.floorUnit = null;
      update.unit = null;
      update.openPlot = null;
      update.innerPlot = null;
    }

    const oldPropertyStatus = lead.propertyStatus;

    const updatedLead = await Lead.findOneAndUpdate(
      { _id: id, isDeleted: false },
      update,
      {
        new: true,
        runValidators: true,
      },
    );

    // 🔔 Notify lead owner if status changed
    if (status && status !== lead.status) {
      await createNotification({
        userId: updatedLead.addedBy,
        title: "Lead Status Updated",
        message: `Lead ${updatedLead.name} status changed from ${lead.status} to ${status}.`,
        triggeredBy: req.user._id,
      });
    }

    res.status(200).json({
      message: "Lead updated successfully",
      updatedLead,
    });
  } catch (error) {
    console.error("Update Lead Error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

export const deleteLeadById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role, _id } = req.user;

  const lead = await Lead.findOne({ _id: id, isDeleted: false });

  if (!lead) throw new ApiError(404, "Lead not found");

  lead.isDeleted = true;
  lead.deletedBy = _id;
  lead.updatedBy = _id;

  await lead.save();

  await lead.deleteOne();

  res
    .status(200)
    .json(
      new ApiResponse(200, null, "Lead and related data deleted successfully"),
    );
});

export const getAvailableProperties = async (req, res) => {
  try {
    const properties = await Property.find({
      isDeleted: false,
      "customerInfo.propertyStatus": {
        $in: ["Available", "Upcoming", "Under Construction"],
      },
    });

    res.status(200).json({ properties });
  } catch (err) {
    console.error("Error fetching available properties:", err.message);
    res
      .status(500)
      .json({ message: "Failed to fetch properties", error: err.message });
  }
};

export const getClosedLeads = asyncHandler(async (req, res) => {
  const accessQuery = await buildLeadAccessQuery(req.user);

  const commissionedLeadRecords = await Commission.find(
    { isDeleted: false },
    "clientId",
  ).lean();
  const commissionedLeadIds = commissionedLeadRecords.map((r) =>
    r.clientId.toString(),
  );

  const closedLeads = await Lead.find({
    ...accessQuery,
    isDeleted: false,
    propertyStatus: "Closed",
    _id: { $nin: commissionedLeadIds },
  })
    // PROPERTY LEADS
    .populate("property", "_id projectName location propertyType")
    .populate("floorUnit", "_id floorNumber unitType")
    .populate("unit", "_id plotNo propertyType totalAmount")

    // OPEN PLOT LEADS
    .populate("openPlot", "_id projectName openPlotNo")
    .populate("innerPlot", "_id plotNo")

    // OPEN LAND LEADS
    .populate("openLand", "_id projectName location landType")

    // USER
    .populate("addedBy", "name email role avatar");

  res
    .status(200)
    .json(
      new ApiResponse(200, closedLeads, "Closed leads fetched successfully"),
    );
});

export const getLeadsByUnitId = asyncHandler(async (req, res) => {
  const { _id } = req.params;

  if (!_id) throw new ApiError(400, "Unit id missing");
  const accessQuery = await buildLeadAccessQuery(req.user);

  const leads = await Lead.find({
    unit: _id,
    isDeleted: false,
    ...accessQuery,
  })
    .populate("property", "_id projectName location propertyType")
    .populate("floorUnit", "_id floorNumber unitType")
    .populate("unit", "_id plotNo propertyType totalAmount")
    .populate("addedBy", "name email role avatar");

  if (!leads || leads.length === 0)
    return res
      .status(200)
      .json(new ApiResponse(200, [], "No leads found for the given unit id"));
  res
    .status(200)
    .json(new ApiResponse(200, leads, "Leads fetched successfully"));
});

export const getLeadsByOpenPlotId = asyncHandler(async (req, res) => {
  const { _id } = req.params;

  if (!_id) throw new ApiError(400, "Open plot id missing");

  const accessQuery = await buildLeadAccessQuery(req.user);

  const leads = await Lead.find({
    innerPlot: _id,
    isDeleted: false,
    isPlotLead: true,
    ...accessQuery,
  })
    .populate("openPlot", "_id projectName openPlotNo")
    .populate("innerPlot", "_id plotNo")
    .populate("addedBy", "name email role avatar");

  if (!leads || leads.length === 0) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, [], "No leads found for the given open plot id"),
      );
  }

  res
    .status(200)
    .json(new ApiResponse(200, leads, "Open plot leads fetched successfully"));
});

export const getLeadsByOpenLandId = asyncHandler(async (req, res) => {
  const { _id } = req.params;

  if (!_id) throw new ApiError(400, "Open land id missing");

  const accessQuery = await buildLeadAccessQuery(req.user);

  const leads = await Lead.find({
    openLand: _id,
    isLandLead: true,
    isDeleted: false,
    ...accessQuery,
  })
    .populate("openLand", "_id projectName location landType")
    .populate("addedBy", "name email role avatar");

  if (!leads || leads.length === 0) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, [], "No leads found for the given open land id"),
      );
  }

  res
    .status(200)
    .json(new ApiResponse(200, leads, "Open land leads fetched successfully"));
});
