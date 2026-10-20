package com.ruoyi.food;

import static com.ruoyi.food.FoodSupport.*;

import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FoodEvidence {
  private final JdbcTemplate db;

  @Value("${ruoyi.profile}")
  private String uploadPath;

  public FoodEvidence(JdbcTemplate db) {
    this.db = db;
  }

  public String save(long member, String order, MultipartFile file) {
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_order WHERE id=? AND member_id=? AND status IN"
                    + " ('PENDING','PREPARING','WAITING_DELIVERY','READY','DELIVERING','COMPLETED')",
                Integer.class,
                order,
                member)
            == 1,
        "订单不存在或不支持举证");
    require(file != null && !file.isEmpty() && file.getSize() <= 5 * 1024 * 1024, "请上传5MB以内的图片");
    require(
        db.queryForObject(
                "SELECT COUNT(*) FROM food_evidence WHERE member_id=? AND order_id=?",
                Integer.class,
                member,
                order)
            < 12,
        "每单最多上传12张凭证");
    try (var stream = ImageIO.createImageInputStream(file.getInputStream())) {
      var readers = ImageIO.getImageReaders(stream);
      require(readers.hasNext(), "仅支持有效的JPEG或PNG图片");
      var reader = readers.next();
      String id = "EV" + UUID.randomUUID().toString().replace("-", "");
      Path dest = null;
      try {
        require(
            Set.of("JPEG", "JPG", "PNG").contains(reader.getFormatName().toUpperCase(Locale.ROOT)),
            "仅支持JPEG或PNG图片");
        reader.setInput(stream);
        int width = reader.getWidth(0), height = reader.getHeight(0);
        require(width > 0 && height > 0 && (long) width * height <= 16000000, "图片像素过大，请压缩后上传");
        var image = reader.read(0);
        Path root =
            Path.of(uploadPath).toAbsolutePath().normalize().resolveSibling("food-evidence");
        Files.createDirectories(root);
        dest = root.resolve(id + ".png");
        ImageIO.write(image, "png", dest.toFile());
        db.update(
            "INSERT INTO food_evidence(id,member_id,order_id,file_path) VALUES(?,?,?,?)",
            id,
            member,
            order,
            dest.toString());
        return id;
      } catch (Exception e) {
        if (dest != null) Files.deleteIfExists(dest);
        throw e;
      } finally {
        reader.dispose();
      }
    } catch (com.ruoyi.common.exception.ServiceException e) {
      throw e;
    } catch (Exception e) {
      throw new com.ruoyi.common.exception.ServiceException("图片上传失败，请重试");
    }
  }

  public Map<String, Object> metadata(String id) {
    var rows = db.queryForList("SELECT * FROM food_evidence WHERE id=?", id);
    require(!rows.isEmpty(), "凭证不存在");
    return rows.get(0);
  }

  public String image(Map<String, Object> row) {
    try {
      return "data:image/png;base64,"
          + Base64.getEncoder().encodeToString(Files.readAllBytes(Path.of(text(row, "file_path"))));
    } catch (Exception e) {
      throw new com.ruoyi.common.exception.ServiceException("图片无法读取");
    }
  }
}
