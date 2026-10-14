package com.spatia.studio;

import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.nio.file.Path;

@RestController
@RequestMapping("/api/audio")
public class AudioController {
    private final AuthService auth;
    private final AudioService audio;
    public AudioController(AuthService auth, AudioService audio) { this.auth = auth; this.audio = audio; }

    @PostMapping("/uploads")
    public UploadView upload(@RequestHeader("Authorization") String header, @RequestParam("file") MultipartFile file) {
        return audio.save(file, auth.require(AuthController.token(header)).id());
    }
    @PostMapping("/renders")
    public RenderView render(@RequestHeader("Authorization") String header, @RequestBody SceneRequest request) {
        return audio.render(request, auth.require(AuthController.token(header)).id());
    }
    @GetMapping("/renders/{id}")
    public ResponseEntity<FileSystemResource> download(@PathVariable String id) {
        Path path = audio.renderFile(id);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + path.getFileName() + "\"").body(new FileSystemResource(path));
    }
}
