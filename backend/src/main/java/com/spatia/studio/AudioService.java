package com.spatia.studio;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AudioService {
    private final Path root;
    private final String matlabCommand;
    private final Map<String, StoredUpload> uploads = new ConcurrentHashMap<>();
    private final Map<String, RenderView> renders = new ConcurrentHashMap<>();

    public AudioService(@Value("${spatia.storage-root}") String root, @Value("${spatia.matlab-command}") String matlabCommand) throws IOException {
        this.root = Paths.get(root).toAbsolutePath().normalize();
        this.matlabCommand = matlabCommand;
        Files.createDirectories(this.root);
    }

    public UploadView save(MultipartFile file, String userId) {
        String name = Optional.ofNullable(file.getOriginalFilename()).orElse("audio.mp3");
        if (!name.toLowerCase().endsWith(".mp3") && !name.toLowerCase().endsWith(".wav")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only MP3 and WAV files are supported");
        }
        String id = UUID.randomUUID().toString();
        Path destination = root.resolve(id + "-" + Paths.get(name).getFileName());
        try { file.transferTo(destination); }
        catch (IOException e) { throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not store upload", e); }
        StoredUpload upload = new StoredUpload(id, userId, destination, name, file.getSize(), file.getContentType(), Instant.now());
        uploads.put(id, upload);
        return new UploadView(id, name, upload.size(), upload.contentType(), upload.uploadedAt());
    }

    public RenderView render(SourceRequest request, String userId) {
        StoredUpload upload = uploads.get(request.uploadId());
        if (upload == null || !upload.userId().equals(userId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Upload not found");
        if (Math.sqrt(request.x() * request.x() + request.y() * request.y() + request.z() * request.z()) == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Source cannot be placed at the listener origin");
        }
        String id = UUID.randomUUID().toString();
        String outputName = Optional.ofNullable(request.outputName()).filter(s -> !s.isBlank()).orElse("spatia-render.mp3");
        Path output = root.resolve(id + "-" + Paths.get(outputName).getFileName());
        try {
            if (matlabCommand == null || matlabCommand.isBlank()) {
                Files.copy(upload.path(), output, StandardCopyOption.REPLACE_EXISTING);
            } else {
                Path script = root.resolve(id + ".m");
                Files.writeString(script, matlabScript(upload.path(), output, request));
                Process process = new ProcessBuilder(matlabCommand, "-batch", "run('" + script.toString().replace("'", "''") + "')").redirectErrorStream(true).start();
                String log = new String(process.getInputStream().readAllBytes());
                if (process.waitFor() != 0) throw new IOException("MATLAB failed: " + log);
                Files.deleteIfExists(script);
            }
        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Spatial render failed: " + e.getMessage(), e);
        }
        RenderView view = new RenderView(id, outputName, "complete", "/api/audio/renders/" + id, "Render complete", List.of(request.x(), request.y(), request.z()));
        renders.put(id, view);
        return view;
    }

    public Path renderFile(String id) {
        RenderView render = renders.get(id);
        if (render == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Render not found");
        return root.resolve(id + "-" + render.filename());
    }

    private String matlabScript(Path input, Path output, SourceRequest request) {
        return "addpath('" + root.resolve("../matlab").normalize().toString().replace("'", "''") + "');\n" +
            "spatializeAudio('" + input.toString().replace("'", "''") + "','" + output.toString().replace("'", "''") +
            "',[" + request.x() + " " + request.y() + " " + request.z() + "],'AllowSynthetic',true,'FfmpegPath','ffmpeg');\n";
    }
    private record StoredUpload(String id, String userId, Path path, String filename, long size, String contentType, Instant uploadedAt) {}
}
