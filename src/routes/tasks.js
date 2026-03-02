import express from "express";
import multer from "multer";
import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import clientPromise from "../lib/mongodb.js";
import { auth } from "../middlewares/auth.js";
import jwt from "jsonwebtoken";
const router = express.Router();
const upload = multer();

/* ======================================
   CREATE TASK
====================================== */
router.post("/create", upload.array("attachment"), async (req, res) => {
  try {
    const {
      title,
      description,
      assignee,
      userId, // ✅ renamed
      assigneeAvatar,
      priority,
      dueDate,
      status,
      tags,
    } = req.body;

    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);

    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!title || !description || !priority || !dueDate || !status || !userId)
      return res.status(400).json({ error: "Missing fields" });

    const attachments = [];

    for (const file of req.files || []) {
      if (file.size > 10 * 1024 * 1024)
        return res.status(400).json({ error: "File too large" });

      const uploaded = await cloudinary.uploader.upload_stream({
        resource_type: "auto",
        folder: "kanban_attachments",
      });

      attachments.push({
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        size: file.size,
        contentType: file.mimetype,
        originalName: file.originalname,
      });
    }

    const client = await clientPromise;
    const db = client.db();

    const task = {
      title,
      description,
      assignee,
      userId: new ObjectId(userId),
      assigneeAvatar,
      priority,
      dueDate: new Date(dueDate),
      status,
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
      attachments,
      createdAt: new Date(),
    };

    const result = await db.collection("tasks").insertOne(task);

     // 🔔 Notify assigned user (ADDED)
    await createNotification({
      userId: new ObjectId(userId),
      title: "New Task Assigned",
      message: `You have been assigned a new task: ${title}.`,
      triggeredBy: payload._id,
    });

    res.status(201).json({
      success: true,
      task: { ...task, _id: result.insertedId },
    });
  } catch (err) {
    console.error("CREATE TASK ERROR", err);
    res.status(500).json({ error: "Create failed" });
  }
});

/* ======================================
   FETCH TASKS
====================================== */
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;

    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (!payload?.id) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const client = await clientPromise;
    const db = client.db();

    const currentUserId = new ObjectId(payload.id);

    // 🔑 FETCH ROLE FROM DB (CRITICAL)
    const currentUser = await db
      .collection("users")
      .findOne(
        { _id: currentUserId },
        { projection: { role: 1 } }
      );

    if (!currentUser) {
      return res.status(401).json({ error: "User not found" });
    }

    // const role = currentUser.role?.toUpperCase();

    const where = {};

    if (userId === currentUserId) {
      where.userId = currentUserId;
      
    }else{
      where.userId = new ObjectId(userId);
    }

    // ADMIN can view selected user's tasks
    // if (role === "ADMIN") {
    //   if (userId) {
        
    //     where.userId = new ObjectId(userId);
    //   }
    //   // else: admin sees all tasks
    // }
    // // NON-ADMIN: only own tasks
    // else {
      
    //   where.userId = currentUserId;
    // }

    const tasks = await db
      .collection("tasks")
      .aggregate([
        { $match: where },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: "comments",
            localField: "_id",
            foreignField: "taskId",
            as: "comments",
          },
        },
      ])
      .toArray();
      console.log("taskkss", tasks);
      
    res.json({ success: true, tasks });
  } catch (err) {
    console.error("FETCH TASK ERROR", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});


/* ======================================
   UPDATE TASK
====================================== */
router.put("/", upload.array("attachment"), async (req, res) => {
  try {
    const { id } = req.body;

    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid task id" });
    }

    const client = await clientPromise;
    const db = client.db();

    const taskId = new ObjectId(id);

    // ✅ build update object safely
    const update = {};

    if (req.body.title) update.title = req.body.title;
    if (req.body.description) update.description = req.body.description;
    if (req.body.assignee) update.assignee = req.body.assignee;
    if (req.body.priority) update.priority = req.body.priority;
    if (req.body.status) update.status = req.body.status;
    if (req.body.tags)
      update.tags = req.body.tags.split(",").map(t => t.trim());
    if (req.body.dueDate)
      update.dueDate = new Date(req.body.dueDate);

    if (req.files?.length) {
      const attachments = [];

      for (const file of req.files) {
        const uploaded = await cloudinary.uploader.upload(file.buffer, {
          folder: "kanban_attachments",
        });

        attachments.push({
          url: uploaded.secure_url,
          public_id: uploaded.public_id,
          size: file.size,
          contentType: file.mimetype,
          originalName: file.originalname,
        });
      }

      update.attachments = attachments;
    }

    // ✅ perform update
    const result = await db
      .collection("tasks")
      .updateOne({ _id: taskId }, { $set: update });

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    // ✅ fetch updated task (THIS WAS MISSING / WRONG)
    const updatedTask = await db
      .collection("tasks")
      .findOne({ _id: taskId });

    // ✅ return what frontend expects
    res.json({
      success: true,
      task: updatedTask,
    });
  } catch (err) {
    console.error("UPDATE ERROR", err);
    res.status(500).json({ error: "Update failed" });
  }
});


/* ======================================
    DELETE TASK
====================================== */
router.delete("/", auth, async (req, res) => {
  try {
    const { id } = req.body;
    const { id: userId, role } = req.user;

    const client = await clientPromise;
    const db = client.db();

    const taskId = new ObjectId(id);
    const currentUserId = new ObjectId(userId);

    const where =
      role === "ADMIN"
        ? { _id: taskId }
        : { _id: taskId, userId: currentUserId };

    const result = await db.collection("tasks").deleteOne(where);

    if (result.deletedCount === 0) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
