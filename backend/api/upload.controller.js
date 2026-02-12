import multer from "multer";
import { v4 as uuid } from "uuid";
import path from "path";

const storage = multer.diskStorage({
  destination: "storage/originals/",
  filename: (req, file, cb) => {
    const id = uuid();
    cb(null, id + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

export default upload;
