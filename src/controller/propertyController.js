import Property from "../modals/propertyModel.js";
import Project from "../modals/projects.js";

export const createProperty = async (req, res) => {
  try {
    const newProperty = new Property(req.body);
    const savedProperty = await newProperty.save();
    res.status(201).json(savedProperty);
  } catch (error) {
    console.error("Error creating property:", error);
    res.status(500).json({ message: "Failed to create property", error });
  }
};

export const getPropertyById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid property ID format" });
    }

    // Fetch the property, using lean to return a plain JS object
    const property = await Property.findById(id).lean();

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Success response
    res.status(200).json(property);
  } catch (error) {
    console.error("Error fetching property by Id", error);
    res
      .status(500)
      .json({ message: "Failed to get property by id", error: error.message });
  }
};

export const updateProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedData = req.body;

    // 🔔 Notification helper (ADDED)
    const notifyPropertySold = async (property) => {
      const receivers = await User.find({
        role: { $in: ["owner", "admin", "accountant"] },
      }).select("_id");

      await Promise.all(
        receivers.map((user) =>
          createNotification({
            userId: user._id,
            title: "Property Sold",
            message: `Property ${property.propertyName || property._id} has been marked as Sold.`,
            triggeredBy: req.user._id,
          })
        )
      );
    };

    // 1. Update the Property
    const existingProperty = await Property.findByIdAndUpdate(id, updatedData, {
      new: true,
    });

    if (!existingProperty) {
      return res.status(404).json({ message: "Property not found" });
    }

    // 🔔 Notify on Sold status (ADDED)
    const propertyStatus =
      updatedData?.customerInfo?.propertyStatus || "";

    if (propertyStatus === "Sold") {
      await notifyPropertySold(existingProperty);
    }

    // 2. Check if siteIncharge exists in request
    const siteIncharge = updatedData?.constructionDetails?.siteIncharge;

    if (siteIncharge) {
      const propertyId = existingProperty._id;

      // Optional fields - extract safely
      const priority = updatedData?.constructionDetails?.priority || "";
      const startDate = updatedData?.constructionDetails?.startDate || null;
      const endDate = updatedData?.constructionDetails?.endDate || null;
      const teamSize = updatedData?.constructionDetails?.teamSize || null;
      const estimatedBudget = updatedData.financialDetails?.totalAmount || null;
      const status = updatedData.customerInfo?.propertyStatus || "";

      // Parse units (optional: fallback to empty array)
      const unitsRaw = updatedData?.constructionDetails?.units || ""; // optional field
      const parsedUnits = unitsRaw
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
      console.log("Parsed Units:", parsedUnits);
      const unitMap = {};
      parsedUnits.forEach((unit) => {
        unitMap[unit] = []; // Initialize empty task list
      });

      const projectPayload = {
        projectId: propertyId,
        siteIncharge,
        units: unitMap,
        priority,
        startDate,
        endDate,
        teamSize,
        estimatedBudget,
        status,
      };

      // 3. Upsert the Project
      await Project.findOneAndUpdate(
        { projectId: propertyId },
        projectPayload,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // 4. Return updated property
    res.status(200).json(existingProperty);
  } catch (error) {
    console.error("Error updating property:", error);
    res.status(500).json({ message: "Failed to update property", error });
  }
};

export const deleteProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const property = await Property.findByIdAndDelete(id);

    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    res
      .status(200)
      .json({ message: "Property deleted successfully", property });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting property", error: error.message });
  }
};

export const getProperties = async (req, res) => {
  try {
    const properties = await Property.find()
      .populate("constructionDetails.contractor", "name email")
      .populate("constructionDetails.siteIncharge", "name email")
      .populate({
        path: "customerInfo.customerId",
        populate: { path: "user", select: "name email" }, // customer name & email
      })
      .populate("customerInfo.agentId", "name email");
    res.status(200).json(properties);
  } catch (error) {
    console.error("Error fetching properties:", error);
    res.status(500).json({ message: "Failed to fetch properties", error });
  }
};

export const getUpcomingProperties = async (req, res) => {
  try {
    const upcomingProperties = await Property.find({
      "basicInfo.projectStatus": "upcoming",
    });

    res.status(200).json(upcomingProperties);
  } catch (error) {
    console.error("Error fetching upcoming properties:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};

export const getOncomingProperties = async (req, res) => {
  try {
    const upcomingProperties = await Property.find({
      "basicInfo.projectStatus": "ongoing",
    });

    res.status(200).json(upcomingProperties);
  } catch (error) {
    console.error("Error fetching ongoing properties:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};

export const getCompletedProperties = async (req, res) => {
  try {
    const upcomingProperties = await Property.find({
      "basicInfo.projectStatus": "completed",
    });

    res.status(200).json(upcomingProperties);
  } catch (error) {
    console.error("Error fetching completed properties:", error);
    res.status(500).json({ message: "Server Error", error });
  }
};

export const getPurchasableProperties = async (req, res) => {
  try {
    const availableProperties = await Property.find({
      "customerInfo.propertyStatus": "Available",
    });

    res.status(200).json({
      success: true,
      count: availableProperties.length,
      data: availableProperties,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
